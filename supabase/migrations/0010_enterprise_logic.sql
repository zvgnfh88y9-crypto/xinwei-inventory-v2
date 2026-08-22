-- 1. 升级产品表：细化库存状态口径
alter table public.inventory_products 
add column if not exists available_stock numeric(12,2) default 0, -- 可用库存
add column if not exists locked_stock numeric(12,2) default 0,    -- 锁定库存（已下销售单未发货）
add column if not exists inspect_stock numeric(12,2) default 0,   -- 待检库存
add column if not exists transit_stock numeric(12,2) default 0,   -- 在途库存
add column if not exists defective_stock numeric(12,2) default 0, -- 次品库存
add column if not exists cost_price numeric(12,2) default 0;
-- 成本价（敏感字段，仅财务/主管可见）

comment on column public.inventory_products.stock is '物理实际总库存 = 可用 + 锁定 + 待检 + 次品';
-- 2. 升级单据表：支持冲销与批次
alter table public.inventory_documents
add column if not exists batch_no text,               -- 导入/操作批次号
add column if not exists original_doc_id uuid references public.inventory_documents(id), -- 冲销关联原单 ID
add column if not exists voided_at timestamptz,       -- 作废时间
add column if not exists voided_by uuid references auth.users(id), -- 作废人
add column if not exists audit_log jsonb default '[]';
-- 审核流水日志

-- 3. 升级流水表：增加冲销标记
alter table public.inventory_movements
add column if not exists is_reversal boolean default false, -- 是否为冲销记录（红冲）
add column if not exists reason_code text;
-- 变动原因代码

-- 4. 角色权限表扩展
-- 建议角色：super_admin, inv_manager, wh_worker, sales, purchase, finance, auditor, employee
alter table public.profiles 
add column if not exists permissions text[] default '{}', -- 细粒度操作权限
add column if not exists data_scope jsonb default '{"warehouse": "all"}';
-- 数据访问范围

-- 5. 修正入账与冲销函数逻辑
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
  v_doc record;
  v_line record;
  v_res jsonb;
begin
  -- 1. 锁定单据并检查状态
  select * into v_doc from inventory_documents where id = p_document_id for update;
  if v_doc.status = 'posted' or v_doc.status = 'voided' then
    return jsonb_build_object('error', '单据状态非法，无法重复入账');
  end if;

  -- 2. 循环处理明细
  for v_line in select * from inventory_document_lines where document_id = p_document_id loop
    -- 默认禁止负库存逻辑（除特殊授权外）
    if v_doc.document_type in ('shipment', 'retail_sale', 'transfer_out') then
       if not exists (select 1 from inventory_products where lower(trim(sku)) = lower(trim(v_line.sku)) and available_stock >= v_line.quantity) then
          return jsonb_build_object('error', '产品 ' || v_line.sku || ' 可用库存不足，禁止操作');
       end if;
    end if;

    -- 更新多态库存字段（此处仅以主库 stock 为例演示，后续需根据单据子类精细化更新 available_stock 等）
    -- 示例：入库增加可用库存和实际库存
    update inventory_products 
    set stock = case when v_doc.document_type in ('receipt', 'production_in') then stock + v_line.quantity else stock - v_line.quantity end,
        available_stock = case when v_doc.document_type in ('receipt', 'production_in') then available_stock + v_line.quantity else available_stock - v_line.quantity end,
        updated_at = now()
    where lower(trim(sku)) = lower(trim(v_line.sku));
    
    -- 插入不可变流水
    insert into inventory_movements (document_id, sku, direction, quantity, business_date, posted_by)
    values (p_document_id, v_line.sku, case when v_doc.document_type in ('receipt', 'production_in') then 'in' else 'out' end, v_line.quantity, current_date, p_actor_id);
  end loop;

  -- 3. 更新状态
  update inventory_documents set status = 'posted', posted_at = now(), posted_by = p_actor_id where id = p_document_id;

  return jsonb_build_object('success', true);
end;
$$;
