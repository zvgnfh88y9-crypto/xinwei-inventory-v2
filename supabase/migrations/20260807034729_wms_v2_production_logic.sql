-- 1. 生产领料函数 (可用原料 -> 成品在制)
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
  -- 获取工单信息
  SELECT * INTO v_order FROM v2_production_orders WHERE id = p_production_id FOR UPDATE;
  IF v_order.status = 'completed' OR v_order.status = 'closed' THEN
    RETURN jsonb_build_object('error', '该工单已完成或已关闭' );
  END IF;

  -- 1. 扣减原材料可用库存
  FOR v_bom IN SELECT * FROM v2_production_bom_lines WHERE production_id = p_production_id LOOP
    UPDATE v2_inventory_balances
    SET quantity = quantity - v_bom.standard_qty,
        updated_at = NOW()
    WHERE warehouse = p_warehouse AND sku_code = v_bom.material_sku AND status = 'available'
      AND quantity >= v_bom.standard_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION '原材料不足: SKU % 在仓库 %', v_bom.material_sku, p_warehouse;
    END IF;

    -- 更新 BOM 领用记录
    UPDATE v2_production_bom_lines SET issued_qty = issued_qty + v_bom.standard_qty WHERE id = v_bom.id;
  END LOOP;

  -- 2. 增加成品在制品数量 (WIP)
  INSERT INTO v2_inventory_balances (warehouse, bin_location, sku_code, batch_no, status, quantity)
  VALUES (p_warehouse, 'workshop', v_order.sku_code, 'default', 'wip', v_order.plan_qty)
  ON CONFLICT (warehouse, bin_location, sku_code, batch_no, status) 
  DO UPDATE SET quantity = v2_inventory_balances.quantity + EXCLUDED.quantity, updated_at = NOW();

  -- 3. 更新工单状态
  UPDATE v2_production_orders SET status = 'in_progress' WHERE id = p_production_id;

  RETURN jsonb_build_object('success', true);
END;
$$;;
