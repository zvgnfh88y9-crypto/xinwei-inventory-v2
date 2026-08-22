-- 2. 生产完工入库函数 (在制 -> 待检成品)
CREATE OR REPLACE FUNCTION public.v2_complete_production(
  p_production_id uuid,
  p_pass_qty numeric,
  p_fail_qty numeric,
  p_warehouse text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order record;
  v_total numeric;
BEGIN
  v_total := p_pass_qty + p_fail_qty;
  -- 1. 获取工单并锁定
  SELECT * INTO v_order FROM v2_production_orders WHERE id = p_production_id FOR UPDATE;
  
  -- 2. 扣减在制品 (WIP)
  UPDATE v2_inventory_balances
  SET quantity = quantity - v_total,
      updated_at = NOW()
  WHERE warehouse = p_warehouse AND sku_code = v_order.sku_code AND status = 'wip'
    AND quantity >= v_total;

  IF NOT FOUND THEN
    RAISE EXCEPTION '在制品不足，无法超额报工';
  END IF;

  -- 3. 增加待检库存 (Pass -> Inspecting)
  INSERT INTO v2_inventory_balances (warehouse, bin_location, sku_code, batch_no, status, quantity)
  VALUES (p_warehouse, 'default', v_order.sku_code, 'default', 'inspecting', p_pass_qty)
  ON CONFLICT (warehouse, bin_location, sku_code, batch_no, status) 
  DO UPDATE SET quantity = v2_inventory_balances.quantity + EXCLUDED.quantity, updated_at = NOW();

  -- 4. 增加不良品库存 (Fail -> Defective)
  IF p_fail_qty > 0 THEN
    INSERT INTO v2_inventory_balances (warehouse, bin_location, sku_code, batch_no, status, quantity)
    VALUES (p_warehouse, 'default', v_order.sku_code, 'default', 'defective', p_fail_qty)
    ON CONFLICT (warehouse, bin_location, sku_code, batch_no, status) 
    DO UPDATE SET quantity = v2_inventory_balances.quantity + EXCLUDED.quantity, updated_at = NOW();
  END IF;

  -- 5. 更新工单状态
  UPDATE v2_production_orders 
  SET actual_qty = actual_qty + p_pass_qty, 
      scrap_qty = scrap_qty + p_fail_qty,
      status = CASE WHEN actual_qty + p_pass_qty >= plan_qty THEN 'completed' ELSE 'in_progress' END
  WHERE id = p_production_id;

  RETURN jsonb_build_object('success', true);
END;
$$;;
