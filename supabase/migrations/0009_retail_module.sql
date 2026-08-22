-- 1. 为产品表新增零售仓库存字段
alter table public.inventory_products 
add column if not exists retail_stock numeric(12,2) default 0,
add column if not exists retail_price numeric(12,2) default 0;
-- 2. 扩展单据类型约束（如果有 check 约束需要更新）
-- 注意：这里假设 inventory_documents 的 document_type 是 text，如果不含约束则无需修改

-- 3. 重写或扩展入账函数逻辑以支持“调拨”和“零售”
create or replace function public.post_inventory_document(
  p_document_id uuid,
  p_actor_id uuid,
  p_actor_name text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_doc_type text;
  v_doc_status text;
  v_line record;
  v_current_main_stock numeric;
  v_current_retail_stock numeric;
  v_res jsonb;
begin
  -- 获取单据基础信息
  select document_type, status into v_doc_type, v_doc_status
  from inventory_documents where id = p_document_id;

  if v_doc_status = 'posted' then
    return jsonb_build_object('error', '该单据已入账，请勿重复操作');
  end if;

  -- 开启事务处理明细
  for v_line in select * from inventory_document_lines where document_id = p_document_id loop
    
    -- 获取当前主库和零售库库存
    select stock, retail_stock into v_current_main_stock, v_current_retail_stock
    from inventory_products where lower(trim(sku)) = lower(trim(v_line.sku));

    if not found then
      return jsonb_build_object('error', '产品 ' || v_line.sku || ' 在主库中不存在，请先创建产品资料');
    end if;

    -- 根据单据类型处理库存变动
    case v_doc_type
      when 'receipt', 'production_in' then
        -- 入库：增加主库库存
        update inventory_products 
        set stock = stock + v_line.quantity, 
            updated_at = now() 
        where lower(trim(sku)) = lower(trim(v_line.sku));
        
        insert into inventory_movements (document_id, sku, direction, quantity, before_stock, after_stock, business_date, posted_by)
        values (p_document_id, v_line.sku, 'in', v_line.quantity, v_current_main_stock, v_current_main_stock + v_line.quantity, current_date, p_actor_id);

      when 'shipment' then
        -- 出库：减少主库库存
        if v_current_main_stock < v_line.quantity then
          return jsonb_build_object('error', '产品 ' || v_line.sku || ' 主库库存不足（当前：' || v_current_main_stock || '）');
        end if;

        update inventory_products 
        set stock = stock - v_line.quantity, 
            updated_at = now() 
        where lower(trim(sku)) = lower(trim(v_line.sku));

        insert into inventory_movements (document_id, sku, direction, quantity, before_stock, after_stock, business_date, posted_by)
        values (p_document_id, v_line.sku, 'out', v_line.quantity, v_current_main_stock, v_current_main_stock - v_line.quantity, current_date, p_actor_id);

      when 'transfer_to_retail' then
        -- 调拨：主库 -> 零售仓
        if v_current_main_stock < v_line.quantity then
          return jsonb_build_object('error', '产品 ' || v_line.sku || ' 主库库存不足以调拨（当前：' || v_current_main_stock || '）');
        end if;

        update inventory_products 
        set stock = stock - v_line.quantity, 
            retail_stock = retail_stock + v_line.quantity,
            updated_at = now() 
        where lower(trim(sku)) = lower(trim(v_line.sku));

        insert into inventory_movements (document_id, sku, direction, quantity, before_stock, after_stock, business_date, posted_by, notes)
        values (p_document_id, v_line.sku, 'out', v_line.quantity, v_current_main_stock, v_current_main_stock - v_line.quantity, current_date, p_actor_id, '调拨至零售仓');

      when 'retail_sale' then
        -- 零售：减少零售仓库存
        if v_current_retail_stock < v_line.quantity then
          return jsonb_build_object('error', '产品 ' || v_line.sku || ' 零售仓库存不足（当前：' || v_current_retail_stock || '）');
        end if;

        update inventory_products 
        set retail_stock = retail_stock - v_line.quantity,
            updated_at = now() 
        where lower(trim(sku)) = lower(trim(v_line.sku));

        insert into inventory_movements (document_id, sku, direction, quantity, before_stock, after_stock, business_date, posted_by, notes)
        values (p_document_id, v_line.sku, 'out', v_line.quantity, v_current_retail_stock, v_current_retail_stock - v_line.quantity, current_date, p_actor_id, '零售出库');

    end case;
  end loop;

  -- 更新单据状态为已入账
  update inventory_documents 
  set status = 'posted', 
      posted_by = p_actor_id, 
      posted_at = now(), 
      updated_at = now() 
  where id = p_document_id;

  return jsonb_build_object('success', true);
end;
$$;
