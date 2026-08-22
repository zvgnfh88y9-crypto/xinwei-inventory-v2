-- 1. 建立单据关联表
CREATE TABLE IF NOT EXISTS public.v2_document_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  relation_type text NOT NULL, -- order_to_production, receipt_to_notice, photo_to_event
  created_at timestamptz DEFAULT now()
);

-- 2. 质检转入库逻辑 (待检 -> 可用/不良)
CREATE OR REPLACE FUNCTION public.v2_finalize_inspection(
  p_inspect_id uuid,
  p_warehouse text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_line record;
  v_receipt_id uuid;
BEGIN
  -- 1. 获取质检单信息
  SELECT receipt_id INTO v_receipt_id FROM v2_quality_inspections WHERE id = p_inspect_id;

  -- 2. 遍历明细执行库存划转
  FOR v_line IN SELECT * FROM v2_quality_inspection_lines WHERE inspect_id = p_inspect_id LOOP
    -- 扣减待检库存
    UPDATE v2_inventory_balances
    SET quantity = quantity - (v_line.pass_qty + v_line.fail_qty),
        updated_at = NOW()
    WHERE warehouse = p_warehouse AND sku_code = v_line.sku_code AND status = 'inspecting';

    -- 增加可用库存 (合格品)
    IF v_line.pass_qty > 0 THEN
      INSERT INTO v2_inventory_balances (warehouse, bin_location, sku_code, batch_no, status, quantity)
      VALUES (p_warehouse, 'default', v_line.sku_code, 'default', 'available', v_line.pass_qty)
      ON CONFLICT (warehouse, bin_location, sku_code, batch_no, status) 
      DO UPDATE SET quantity = v2_inventory_balances.quantity + EXCLUDED.quantity, updated_at = NOW();
    END IF;

    -- 增加不良品库存 (不合格品)
    IF v_line.fail_qty > 0 THEN
      INSERT INTO v2_inventory_balances (warehouse, bin_location, sku_code, batch_no, status, quantity)
      VALUES (p_warehouse, 'default', v_line.sku_code, 'default', 'defective', v_line.fail_qty)
      ON CONFLICT (warehouse, bin_location, sku_code, batch_no, status) 
      DO UPDATE SET quantity = v2_inventory_balances.quantity + EXCLUDED.quantity, updated_at = NOW();
    END IF;
  END LOOP;

  -- 3. 更新单据状态
  UPDATE v2_quality_inspections SET status = 'completed' WHERE id = p_inspect_id;
  UPDATE v2_warehouse_receipts SET status = 'inspected' WHERE id = v_receipt_id;

  RETURN jsonb_build_object('success', true);
END;
$$;;
