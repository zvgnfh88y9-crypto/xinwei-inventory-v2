-- 2026-08-26 Restore Production-QC Linkage and fix regression in v2_complete_production
-- This script ensures that completing production creates a warehouse receipt for QC.

-- 1. Ensure a 'Production Workshop' partner exists for internal traceability
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM v2_business_partners WHERE name = '生产车间') THEN
        INSERT INTO v2_business_partners (name, partner_type) VALUES ('生产车间', 'internal');
    END IF;
END $$;

-- 2. Restore and Enhance v2_complete_production
CREATE OR REPLACE FUNCTION public.v2_complete_production(
  p_production_id uuid,
  p_pass_qty numeric,
  p_fail_qty numeric default 0,
  p_warehouse text default '主仓库',
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.v2_production_orders%rowtype;
  v_line public.v2_production_bom_lines%rowtype;
  v_new_total numeric;
  v_receipt_id uuid;
  v_receipt_no text;
  v_unit text := '件';
  v_partner_id uuid;
begin
  -- 1. 获取并锁定工单
  select * into v_order from public.v2_production_orders where id = p_production_id for update;
  if not found then raise exception '生产工单不存在'; end if;
  if v_order.status <> 'in_progress' then raise exception '只有生产中的工单可以汇报完工'; end if;
  if p_pass_qty < 0 or p_fail_qty < 0 or (p_pass_qty + p_fail_qty) <= 0 then raise exception '完工数量必须大于 0'; end if;

  v_new_total := v_order.actual_qty + v_order.scrap_qty + p_pass_qty + p_fail_qty;
  if v_new_total > v_order.plan_qty then
    raise exception '本次报工后数量 % 超过计划数量 %', v_new_total, v_order.plan_qty;
  end if;

  -- 获取产品单位
  select coalesce(base_unit, '件') into v_unit from public.v2_product_main where sku_code = v_order.sku_code;
  
  -- 获取“生产车间”单位 ID
  select id into v_partner_id from v2_business_partners where name = '生产车间' limit 1;

  -- 2. 扣减在制品 (WIP) - 使用幂等方式扣减
  -- 注意：p_pass_qty + p_fail_qty 是本次投入报工的总数，从 wip 状态扣除
  perform public.v2_consume_balance(v_order.sku_code, p_warehouse, 'wip', p_pass_qty + p_fail_qty, p_production_id::text);

  -- 3. 处理合格品 -> 进入待检 (Inspecting) 并生成收货单
  if p_pass_qty > 0 then
    -- 增加待检库存
    perform public.v2_add_balance(v_order.sku_code, p_warehouse, 'inspecting', p_pass_qty, p_production_id::text, '');
    
    -- 生成收货单号 (PR-前缀表示 Production Receipt)
    v_receipt_no := 'PR-' || regexp_replace(v_order.order_no, '[^A-Za-z0-9_-]', '', 'g') || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    
    -- 插入收货单，关联“生产车间”
    insert into public.v2_warehouse_receipts(receipt_no, status, partner_id, received_by, notes)
    values (v_receipt_no, 'received', v_partner_id, p_actor_id, '生产完工自动生成，工单：' || v_order.order_no)
    returning id into v_receipt_id;
    
    -- 插入明细，保存生产工单 ID 到 batch_no 用于质检后的自动分配
    insert into public.v2_warehouse_receipt_lines(receipt_id, sku_code, received_qty, unit, batch_no, warehouse)
    values (v_receipt_id, v_order.sku_code, p_pass_qty, v_unit, p_production_id::text, p_warehouse);
  end if;

  -- 4. 处理不良品 -> 直接进入不良品库存 (Defective)
  if p_fail_qty > 0 then
    perform public.v2_add_balance(v_order.sku_code, p_warehouse, 'defective', p_fail_qty, p_production_id::text, '');
  end if;

  -- 5. 更新工单进度
  update public.v2_production_orders
  set actual_qty = actual_qty + p_pass_qty,
      scrap_qty = scrap_qty + p_fail_qty,
      status = case when v_new_total >= plan_qty then 'completed' else 'in_progress' end,
      completed_at = case when v_new_total >= plan_qty then now() else completed_at end,
      updated_at = now()
  where id = p_production_id;

  -- 6. 如果全单完工，清理可能存在的 BOM 在制余量（虽然理论上应刚好扣完）
  -- 这一步是为了健壮性，防止因为多次报工导致的计算微差
  if v_new_total >= v_order.plan_qty then
    -- 可以在这里处理 BOM 相关的 wip 清理逻辑，但 issue_materials 已经一次性转了 plan_qty 到 wip
    -- v2_consume_balance 已经扣减了本次报工的对应比例
  end if;

  return jsonb_build_object(
    'completed_total', v_new_total,
    'status', case when v_new_total >= v_order.plan_qty then 'completed' else 'in_progress' end,
    'inspection_receipt_id', v_receipt_id
  );
end;
$$;
