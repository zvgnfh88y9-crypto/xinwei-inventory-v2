-- 1. 收货登记函数 (增加入待检)
CREATE OR REPLACE FUNCTION public.v2_post_warehouse_receipt(
  p_receipt_id uuid,
  p_warehouse text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_line record;
BEGIN
  -- 1. 遍历收货行
  FOR v_line IN SELECT * FROM v2_warehouse_receipt_lines WHERE receipt_id = p_receipt_id LOOP
    -- 增加待检库存
    INSERT INTO v2_inventory_balances (warehouse, bin_location, sku_code, batch_no, status, quantity)
    VALUES (p_warehouse, 'default', v_line.sku_code, COALESCE(v_line.batch_no, 'default'), 'inspecting', v_line.received_qty)
    ON CONFLICT (warehouse, bin_location, sku_code, batch_no, status) 
    DO UPDATE SET quantity = v2_inventory_balances.quantity + EXCLUDED.quantity, updated_at = NOW();
    
    -- 记录流水
    INSERT INTO v2_inventory_movements (balance_id, change_qty, qty_before, qty_after, actor_id)
    SELECT id, v_line.received_qty, quantity - v_line.received_qty, quantity, p_actor_id
    FROM v2_inventory_balances
    WHERE warehouse = p_warehouse AND sku_code = v_line.sku_code AND status = 'inspecting' AND batch_no = COALESCE(v_line.batch_no, 'default');
  END LOOP;

  -- 2. 更新单据状态
  UPDATE v2_warehouse_receipts SET status = 'received', received_at = NOW() WHERE id = p_receipt_id;

  RETURN jsonb_build_object('success', true);
END;
$$;;
