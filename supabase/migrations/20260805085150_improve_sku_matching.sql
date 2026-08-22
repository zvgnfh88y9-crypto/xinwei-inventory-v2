create or replace function public.post_inventory_document(p_document_id uuid, p_actor_id uuid, p_actor_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare doc record; line record; product record; direction_value text; before_value numeric; after_value numeric; total_value numeric := 0; line_count integer := 0;
begin
  select * into doc from public.inventory_documents where id = p_document_id for update;
  if not found then raise exception '单据不存在'; end if;
  if doc.status <> 'approved' then raise exception '只有已审核单据可以入账'; end if;
  for line in select * from public.inventory_document_lines where document_id = doc.id loop
    -- Improved SKU matching: trim whitespace and ignore case
    select * into product from public.inventory_products where lower(trim(sku)) = lower(trim(line.sku)) for update;
    if not found then raise exception '产品编号（%）在库存系统中不存在，入账前请先在【主库存管理】中建立该产品档案', line.sku; end if;
    direction_value := case when doc.document_type = 'shipment' then 'out' else 'in' end;
    before_value := product.stock;
    if direction_value = 'out' then
      if product.stock < line.quantity then raise exception '库存不足：%，当前库存 %，出货数量 %', line.sku, product.stock, line.quantity; end if;
      after_value := product.stock - line.quantity;
    else after_value := product.stock + line.quantity; end if;
    update public.inventory_products set stock = after_value, status = case when after_value <= 0 then 'Out of Stock' when after_value <= 100 then 'Low Stock' when after_value >= 500 then 'High Stock' else 'In Stock' end, updated_by = p_actor_id, updated_at = now() where id = product.id;
    insert into public.inventory_movements (document_id, line_id, sku, direction, quantity, before_stock, after_stock, business_date, actor_id, actor_name) values (doc.id, line.id, product.sku, direction_value, line.quantity, before_value, after_value, doc.business_date, p_actor_id, coalesce(p_actor_name, ''));
    insert into public.inventory_activity (sku, product_name, action, quantity_label, detail, changes, actor_id, actor_name) values (product.sku, coalesce(line.product_name, product.name), case when direction_value = 'out' then 'OUT' else 'IN' end, case when direction_value = 'out' then '-' else '+' end || line.quantity::text, case when direction_value = 'out' then '出货单入账 ' else '入库单入账 ' end || doc.doc_no, '库存：' || before_value::text || ' → ' || after_value::text, p_actor_id, coalesce(p_actor_name, ''));
    total_value := total_value + line.quantity; line_count := line_count + 1;
  end loop;
  update public.inventory_documents set status = 'posted', posted_by = p_actor_id, posted_at = now(), updated_at = now() where id = doc.id;
  return jsonb_build_object('document_id', doc.id, 'doc_no', doc.doc_no, 'line_count', line_count, 'total_quantity', total_value);
end; $$;;
