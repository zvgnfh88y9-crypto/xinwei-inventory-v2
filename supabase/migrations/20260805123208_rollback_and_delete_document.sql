create or replace function public.rollback_and_delete_document(p_document_id uuid, p_actor_id uuid, p_actor_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare doc record; move record; product record; reversed_qty numeric;
begin
  select * into doc from public.inventory_documents where id = p_document_id for update;
  if not found then raise exception '单据不存在'; end if;

  -- If posted, we must reverse inventory first
  if doc.status = 'posted' then
    for move in select * from public.inventory_movements where document_id = doc.id loop
      select * into product from public.inventory_products where sku = move.sku for update;
      if found then
        -- Reverse the direction: if it was 'in', now it is 'out'
        reversed_qty := case when move.direction = 'in' then -move.quantity else move.quantity end;
        
        update public.inventory_products
          set stock = stock + reversed_qty,
              status = case when (stock + reversed_qty) <= 0 then 'Out of Stock' when (stock + reversed_qty) <= 100 then 'Low Stock' when (stock + reversed_qty) >= 500 then 'High Stock' else 'In Stock' end,
              updated_by = p_actor_id,
              updated_at = now()
          where id = product.id;

        insert into public.inventory_activity (sku, product_name, action, quantity_label, detail, changes, actor_id, actor_name)
        values (product.sku, product.name, 'OUT', '冲销', '删除并撤销单据 ' || doc.doc_no, '库存：单据撤销回滚', p_actor_id, coalesce(p_actor_name, ''));
      end if;
    end loop;
    
    -- Delete movements and lines before deleting the document
    delete from public.inventory_movements where document_id = doc.id;
  end if;

  delete from public.inventory_document_lines where document_id = doc.id;
  delete from public.inventory_documents where id = doc.id;

  return jsonb_build_object('success', true, 'doc_no', doc.doc_no);
end; $$;;
