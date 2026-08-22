-- 1. 锁定库存函数
CREATE OR REPLACE FUNCTION public.v2_lock_inventory(
  p_plan_id uuid,
  p_warehouse text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_line record;
  v_balance_id uuid;
BEGIN
  -- 1. 检查状态
  IF (SELECT status FROM v2_shipment_plans WHERE id = p_plan_id) != 'draft' THEN
    RETURN jsonb_build_object('error', '该计划已锁定或已执行');
  END IF;

  -- 2. 遍历明细尝试锁定
  FOR v_line IN SELECT * FROM v2_shipment_plan_lines WHERE plan_id = p_plan_id LOOP
    -- 获取或创建余额行 (可用库存)
    INSERT INTO v2_inventory_balances (warehouse, bin_location, sku_code, batch_no, status, quantity)
    VALUES (p_warehouse, 'default', v_line.sku_code, 'default', 'available', 0)
    ON CONFLICT (warehouse, bin_location, sku_code, batch_no, status) DO NOTHING;
    
    -- 原子性检查与转移
    UPDATE v2_inventory_balances
    SET quantity = quantity - v_line.plan_qty,
        updated_at = NOW()
    WHERE warehouse = p_warehouse AND sku_code = v_line.sku_code AND status = 'available'
      AND quantity >= v_line.plan_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION '库存不足: SKU % 在仓库 %', v_line.sku_code, p_warehouse;
    END IF;

    -- 增加锁定库存
    INSERT INTO v2_inventory_balances (warehouse, bin_location, sku_code, batch_no, status, quantity)
    VALUES (p_warehouse, 'default', v_line.sku_code, 'default', 'locked', v_line.plan_qty)
    ON CONFLICT (warehouse, bin_location, sku_code, batch_no, status) 
    DO UPDATE SET quantity = v2_inventory_balances.quantity + EXCLUDED.quantity, updated_at = NOW();
  END LOOP;

  -- 3. 更新计划状态
  UPDATE v2_shipment_plans SET status = 'locked' WHERE id = p_plan_id;

  RETURN jsonb_build_object('success', true);
END;
$$;;
