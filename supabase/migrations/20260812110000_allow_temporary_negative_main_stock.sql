-- Physical stock is still being counted. Allow main-warehouse shipments to
-- create an explicit negative balance while keeping transfer/retail guards.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.inventory_products'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'stock.*>=.*0'
  loop execute format('alter table public.inventory_products drop constraint %I', r.conname); end loop;

  for r in
    select conname from pg_constraint
    where conrelid = 'public.v2_inventory_balances'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'quantity.*>=.*0'
  loop execute format('alter table public.v2_inventory_balances drop constraint %I', r.conname); end loop;
end $$;

create or replace function public.v2_consume_balance(
  p_sku text, p_warehouse text, p_status text, p_quantity numeric,
  p_batch_no text default ''
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_need numeric := p_quantity;
  v_row record;
  v_take numeric;
begin
  if p_quantity < 0 then raise exception '扣减库存数量不能为负数'; end if;
  if p_quantity = 0 then return; end if;

  for v_row in
    select id, quantity from public.v2_inventory_balances
    where sku_code = p_sku
      and warehouse = coalesce(nullif(p_warehouse,''),'主仓库')
      and status = p_status and quantity > 0
      and (coalesce(p_batch_no,'') = '' or batch_no = p_batch_no)
    order by case when batch_no = p_batch_no and p_batch_no <> '' then 0 else 1 end,
             created_at, id for update
  loop
    exit when v_need <= 0;
    v_take := least(v_row.quantity, v_need);
    update public.v2_inventory_balances
      set quantity = quantity - v_take, updated_at = now() where id = v_row.id;
    v_need := v_need - v_take;
  end loop;

  if v_need > 0 then
    insert into public.v2_inventory_balances
      (sku_code, warehouse, bin_location, status, batch_no, quantity, updated_at)
    values
      (p_sku, coalesce(nullif(p_warehouse,''),'主仓库'), '', p_status,
       coalesce(nullif(p_batch_no,''),'NEGATIVE-PENDING-COUNT'), -v_need, now())
    on conflict (sku_code, warehouse, bin_location, status, batch_no)
    do update set quantity = public.v2_inventory_balances.quantity - v_need, updated_at = now();
  end if;
end;
$$;

revoke execute on function public.v2_consume_balance(text,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.v2_consume_balance(text,text,text,numeric,text) to service_role;

create or replace function public.post_inventory_document(
  p_document_id uuid, p_actor_id uuid, p_actor_name text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_doc public.inventory_documents%rowtype;
  v_line public.inventory_document_lines%rowtype;
  v_product public.inventory_products%rowtype;
  v_before numeric; v_after numeric; v_direction text; v_note text;
  v_line_count integer := 0; v_total numeric := 0;
begin
  select * into v_doc from public.inventory_documents where id = p_document_id for update;
  if not found then raise exception '单据不存在'; end if;
  if v_doc.status <> 'approved' then raise exception '只有已审核单据可以入账'; end if;

  for v_line in select * from public.inventory_document_lines where document_id = p_document_id order by created_at loop
    select * into v_product from public.inventory_products where lower(trim(sku)) = lower(trim(v_line.sku)) for update;
    if not found then raise exception '产品编号不存在：%', v_line.sku; end if;

    case v_doc.document_type
      when 'receipt', 'production_in' then
        v_before := v_product.stock; v_after := v_product.stock + v_line.quantity;
        v_direction := 'in'; v_note := '主仓入库';
        update public.inventory_products set
          stock = stock + v_line.quantity, available_stock = available_stock + v_line.quantity,
          status = case when stock + v_line.quantity <= 0 then 'Out of Stock' when stock + v_line.quantity <= 100 then 'Low Stock' when stock + v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
          updated_by = p_actor_id, updated_at = now() where id = v_product.id;
      when 'shipment' then
        v_before := v_product.stock; v_after := v_product.stock - v_line.quantity;
        v_direction := 'out';
        v_note := case when v_after < 0 then '主仓出库 · 负库存待盘点补齐' else '主仓出库' end;
        update public.inventory_products set
          stock = stock - v_line.quantity, available_stock = available_stock - v_line.quantity,
          status = case when stock - v_line.quantity <= 0 then 'Out of Stock' when stock - v_line.quantity <= 100 then 'Low Stock' when stock - v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
          updated_by = p_actor_id, updated_at = now() where id = v_product.id;
      when 'transfer_to_retail' then
        if v_product.available_stock < v_line.quantity or v_product.stock < v_line.quantity then
          raise exception '产品 % 主仓可用库存不足：当前可用 %，调拨 %', v_line.sku, v_product.available_stock, v_line.quantity;
        end if;
        v_before := v_product.stock; v_after := v_product.stock - v_line.quantity;
        v_direction := 'out'; v_note := '主仓调拨至零售仓';
        update public.inventory_products set
          stock = stock - v_line.quantity, available_stock = available_stock - v_line.quantity,
          retail_stock = retail_stock + v_line.quantity,
          status = case when stock - v_line.quantity <= 0 then 'Out of Stock' when stock - v_line.quantity <= 100 then 'Low Stock' when stock - v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
          updated_by = p_actor_id, updated_at = now() where id = v_product.id;
      when 'retail_sale' then
        if v_product.retail_stock < v_line.quantity then
          raise exception '产品 % 零售仓库存不足：当前 %，出库 %', v_line.sku, v_product.retail_stock, v_line.quantity;
        end if;
        v_before := v_product.retail_stock; v_after := v_product.retail_stock - v_line.quantity;
        v_direction := 'out'; v_note := '零售仓出库';
        update public.inventory_products set retail_stock = retail_stock - v_line.quantity,
          updated_by = p_actor_id, updated_at = now() where id = v_product.id;
      else raise exception '不支持的单据类型：%', v_doc.document_type;
    end case;

    insert into public.inventory_movements
      (document_id,line_id,sku,direction,quantity,before_stock,after_stock,business_date,actor_id,actor_name,is_reversal,notes)
    values (v_doc.id,v_line.id,v_line.sku,v_direction,v_line.quantity,v_before,v_after,v_doc.business_date,p_actor_id,coalesce(p_actor_name,''),false,v_note);
    insert into public.inventory_activity
      (product_id,sku,product_name,action,quantity_label,detail,changes,actor_id,actor_name)
    values (v_product.id,v_line.sku,coalesce(nullif(v_line.product_name,''),v_product.name),
      case when v_direction='in' then 'IN' else 'OUT' end,
      case when v_direction='in' then '+' else '-' end || v_line.quantity::text,
      v_note || ' · ' || v_doc.doc_no, '余额：' || v_before::text || ' → ' || v_after::text,
      p_actor_id,coalesce(p_actor_name,''));
    v_line_count := v_line_count + 1; v_total := v_total + v_line.quantity;
  end loop;
  update public.inventory_documents set status='posted',posted_by=p_actor_id,posted_at=now(),updated_at=now() where id=v_doc.id;
  return jsonb_build_object('success',true,'document_id',v_doc.id,'doc_no',v_doc.doc_no,'line_count',v_line_count,'total_quantity',v_total);
end;
$$;

revoke execute on function public.post_inventory_document(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.post_inventory_document(uuid,uuid,text) to service_role;
