-- 单据红冲/作废函数：执行反向库存抵消并记录流水
create or replace function public.void_inventory_document(
  p_document_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_doc record;
  v_line record;
  v_current_stock record;
begin
  -- 1. 锁定单据
  select * into v_doc from inventory_documents where id = p_document_id for update;
  if v_doc.status != 'posted' then
    return jsonb_build_object('error', '只有已入账单据可以执行红冲作废');
  end if;

  -- 2. 循环明细执行反向操作
  for v_line in select * from inventory_document_lines where document_id = p_document_id loop
    
    -- 获取当前各状态库存
    select stock, available_stock into v_current_stock
    from inventory_products where lower(trim(sku)) = lower(trim(v_line.sku));

    -- 根据原单方向进行反向抵消
    -- 入库 -> 扣减库存； 出库 -> 恢复库存
    update inventory_products 
    set stock = case when v_doc.document_type in ('receipt', 'production_in') then stock - v_line.quantity else stock + v_line.quantity end,
        available_stock = case when v_doc.document_type in ('receipt', 'production_in') then available_stock - v_line.quantity else available_stock + v_line.quantity end,
        updated_at = now()
    where lower(trim(sku)) = lower(trim(v_line.sku));
    
    -- 插入红冲流水记录
    insert into inventory_movements (document_id, sku, direction, quantity, business_date, posted_by, is_reversal, notes)
    values (
      p_document_id, 
      v_line.sku, 
      case when v_doc.document_type in ('receipt', 'production_in') then 'out' else 'in' end, 
      v_line.quantity, 
      current_date, 
      p_actor_id, 
      true, 
      '红冲对冲记录：' || p_reason
    );
  end loop;

  -- 3. 更新单据状态为作废
  update inventory_documents 
  set status = 'voided', 
      voided_at = now(), 
      voided_by = p_actor_id, 
      notes = p_reason 
  where id = p_document_id;

  return jsonb_build_object('success', true);
end;
$$;
