-- 修复红冲逻辑：补全流水表所需的 line_id, before_stock, after_stock 字段
CREATE OR REPLACE FUNCTION public.void_inventory_document(
  p_document_id uuid,
  p_actor_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_doc record;
  v_new_doc_id uuid;
  v_line record;
  v_current_stock record;
  v_new_line_id uuid;
  v_before numeric;
  v_after numeric;
BEGIN
  -- 1. 幂等与状态校验
  SELECT * INTO v_old_doc FROM inventory_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '单据未找到'); END IF;
  IF v_old_doc.status = 'voided' THEN RETURN jsonb_build_object('success', true, 'message', '单据已是作废状态'); END IF;
  IF v_old_doc.status != 'posted' THEN RETURN jsonb_build_object('error', '只有已入账单据可以执行红冲'); END IF;

  -- 2. 创建红冲冲销单
  INSERT INTO inventory_documents (
    doc_no, document_type, status, business_date, partner_name, order_no, 
    notes, created_by, posted_by, posted_at, original_doc_id
  ) VALUES (
    'REV-' || v_old_doc.doc_no,
    v_old_doc.document_type,
    'posted',
    CURRENT_DATE,
    v_old_doc.partner_name,
    v_old_doc.order_no,
    '红冲原单: ' || v_old_doc.doc_no || ' 原因: ' || p_reason,
    p_actor_id,
    p_actor_id,
    NOW(),
    p_document_id
  ) RETURNING id INTO v_new_doc_id;

  -- 3. 循环处理明细
  FOR v_line IN SELECT * FROM inventory_document_lines WHERE document_id = p_document_id LOOP
    -- 获取当前库存 (before)
    SELECT stock INTO v_before FROM inventory_products WHERE lower(trim(sku)) = lower(trim(v_line.sku));
    
    -- 计算反向增量
    -- 如果原单是入库 (receipt/production_in), 红冲就是出库 (-qty)
    -- 如果原单是出库 (shipment/retail_sale), 红冲就是入库 (+qty)
    IF v_old_doc.document_type IN ('receipt', 'production_in') THEN
      v_after := v_before - v_line.quantity;
    ELSE
      v_after := v_before + v_line.quantity;
    END IF;

    -- 插入冲销明细 (负数数量)
    INSERT INTO inventory_document_lines (
      document_id, sku, product_name, quantity, unit, batch_no, warehouse, unit_price
    ) VALUES (
      v_new_doc_id, v_line.sku, v_line.product_name, -v_line.quantity, v_line.unit, v_line.batch_no, v_line.warehouse, v_line.unit_price
    ) RETURNING id INTO v_new_line_id;

    -- 更新库存
    UPDATE inventory_products 
    SET stock = v_after,
        available_stock = available_stock + (v_after - v_before),
        updated_at = NOW()
    WHERE lower(trim(sku)) = lower(trim(v_line.sku));

    -- 插入红冲流水
    INSERT INTO inventory_movements (
      document_id, line_id, sku, direction, quantity, before_stock, after_stock, business_date, posted_by, is_reversal, notes
    ) VALUES (
      v_new_doc_id, 
      v_new_line_id,
      v_line.sku, 
      CASE WHEN v_old_doc.document_type IN ('receipt', 'production_in') THEN 'out' ELSE 'in' END, 
      v_line.quantity, 
      v_before,
      v_after,
      CURRENT_DATE, 
      p_actor_id, 
      TRUE, 
      '系统红冲自动对冲流水');
  END LOOP;

  -- 4. 标记原单为已作废
  UPDATE inventory_documents 
  SET status = 'voided', 
      voided_at = NOW(), 
      voided_by = p_actor_id,
      audit_log = audit_log || jsonb_build_array(jsonb_build_object('action', 'voided', 'at', now(), 'by', p_actor_id, 'reason', p_reason))
  WHERE id = p_document_id;

  RETURN jsonb_build_object('success', true, 'reversal_id', v_new_doc_id);
END;
$$;;
