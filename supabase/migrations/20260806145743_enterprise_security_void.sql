-- 1. 强化 RLS 策略
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can do everything on import_batches" ON public.import_batches;
CREATE POLICY "Admins can do everything on import_batches" ON public.import_batches
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

ALTER TABLE public.inventory_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view docs they created or if they are admin" ON public.inventory_documents;
CREATE POLICY "Users can view docs they created or if they are admin" ON public.inventory_documents
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- 禁止物理删除已入账/已审核单据
DROP POLICY IF EXISTS "Prevent deletion of non-draft docs" ON public.inventory_documents;
CREATE POLICY "Prevent deletion of non-draft docs" ON public.inventory_documents
  FOR DELETE TO authenticated
  USING (status = 'draft' AND (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')));

-- 2. 升级红冲逻辑：支持原单关联与幂等
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
BEGIN
  -- 1. 幂等与状态校验
  SELECT * INTO v_old_doc FROM inventory_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '单据未找到'); END IF;
  IF v_old_doc.status = 'voided' THEN RETURN jsonb_build_object('success', true, 'message', '单据已是作废状态'); END IF;
  IF v_old_doc.status != 'posted' THEN RETURN jsonb_build_object('error', '只有已入账单据可以执行红冲'); END IF;

  -- 2. 创建红冲冲销单 (Reversal Document)
  INSERT INTO inventory_documents (
    doc_no, document_type, status, business_date, partner_name, order_no, 
    notes, created_by, posted_by, posted_at, original_doc_id
  ) VALUES (
    'REversal-' || v_old_doc.doc_no,
    v_old_doc.document_type,
    'posted',
    CURRENT_DATE,
    v_old_doc.partner_name,
    v_old_doc.order_no,
    '红冲原单据: ' || v_old_doc.doc_no || ' 原因: ' || p_reason,
    p_actor_id,
    p_actor_id,
    NOW(),
    p_document_id
  ) RETURNING id INTO v_new_doc_id;

  -- 3. 循环处理明细并生成负数流水
  FOR v_line IN SELECT * FROM inventory_document_lines WHERE document_id = p_document_id LOOP
    -- 插入冲销明细 (负数数量)
    INSERT INTO inventory_document_lines (
      document_id, sku, product_name, quantity, unit, batch_no, warehouse, unit_price
    ) VALUES (
      v_new_doc_id, v_line.sku, v_line.product_name, -v_line.quantity, v_line.unit, v_line.batch_no, v_line.warehouse, v_line.unit_price
    );

    -- 更新库存 (反向操作)
    UPDATE inventory_products 
    SET stock = CASE WHEN v_old_doc.document_type IN ('receipt', 'production_in') THEN stock - v_line.quantity ELSE stock + v_line.quantity END,
        available_stock = CASE WHEN v_old_doc.document_type IN ('receipt', 'production_in') THEN available_stock - v_line.quantity ELSE available_stock + v_line.quantity END,
        updated_at = NOW()
    WHERE lower(trim(sku)) = lower(trim(v_line.sku));

    -- 插入红冲流水
    INSERT INTO inventory_movements (
      document_id, sku, direction, quantity, business_date, posted_by, is_reversal, notes
    ) VALUES (
      v_new_doc_id, 
      v_line.sku, 
      CASE WHEN v_old_doc.direction = 'in' THEN 'out' ELSE 'in' END, -- 假设有 direction 字段，或根据 type 推断
      v_line.quantity, 
      CURRENT_DATE, 
      p_actor_id, 
      TRUE, 
      '系统自动生成的红冲冲销流水');
  END LOOP;

  -- 4. 标记原单为已作废
  UPDATE inventory_documents 
  SET status = 'voided', 
      voided_at = NOW(), 
      voided_by = p_actor_id, 
      notes = '已红冲，冲销单号: ' || (SELECT doc_no FROM inventory_documents WHERE id = v_new_doc_id)
  WHERE id = p_document_id;

  RETURN jsonb_build_object('success', true, 'reversal_id', v_new_doc_id);
END;
$$;;
