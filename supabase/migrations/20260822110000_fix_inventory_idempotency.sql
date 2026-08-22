-- 2026-08-22 Idempotency Fix: Ensure production material issuance is idempotent.
-- This script hardens v2_issue_production_materials to prevent double-issuing materials.

CREATE OR REPLACE FUNCTION public.v2_issue_production_materials(
  p_production_id uuid,
  p_warehouse text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bom record;
  v_order record;
BEGIN
  -- 锁定并获取工单信息
  SELECT * INTO v_order FROM v2_production_orders WHERE id = p_production_id FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '生产工单不存在');
  END IF;

  -- 核心幂等逻辑：只有草稿状态允许执行“首次领料”
  -- 如果工单已经是 in_progress，说明料已经领过了
  IF v_order.status <> 'draft' THEN
    RETURN jsonb_build_object('error', '该工单当前状态为 ' || v_order.status || '，无法重复领料');
  END IF;

  -- 1. 扣减原材料可用库存
  FOR v_bom IN SELECT * FROM v2_production_bom_lines WHERE production_id = p_production_id LOOP
    -- 额外防重逻辑：如果该 BOM 行已经有领用记录，跳过（或者报错）
    IF v_bom.issued_qty > 0 THEN
        CONTINUE;
    END IF;

    UPDATE v2_inventory_balances
    SET quantity = quantity - v_bom.standard_qty,
        updated_at = NOW()
    WHERE warehouse = p_warehouse AND sku_code = v_bom.material_sku AND status = 'available'
      AND quantity >= v_bom.standard_qty;

    IF NOT FOUND THEN
      -- 触发异常会自动回滚整个事务
      RAISE EXCEPTION '原材料不足: SKU % 在仓库 %，需要 %', v_bom.material_sku, p_warehouse, v_bom.standard_qty;
    END IF;

    -- 更新 BOM 领用记录
    UPDATE v2_production_bom_lines SET issued_qty = v_bom.standard_qty WHERE id = v_bom.id;
  END LOOP;

  -- 2. 增加成品在制品数量 (WIP)
  -- 这里的 batch_no 使用生产工单 ID 建立链路，避免和其他工单混淆
  INSERT INTO v2_inventory_balances (warehouse, bin_location, sku_code, batch_no, status, quantity)
  VALUES (p_warehouse, 'workshop', v_order.sku_code, p_production_id::text, 'wip', v_order.plan_qty)
  ON CONFLICT (warehouse, bin_location, sku_code, batch_no, status) 
  DO UPDATE SET quantity = v2_inventory_balances.quantity + EXCLUDED.quantity, updated_at = NOW();

  -- 3. 更新工单状态
  UPDATE v2_production_orders SET status = 'in_progress' WHERE id = p_production_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
