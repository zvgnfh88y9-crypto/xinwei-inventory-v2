-- 1. 单据全链路溯源函数
-- 给定一个单据ID，递归查找其前置和后继关联
CREATE OR REPLACE FUNCTION public.v2_get_document_trace_chain(p_doc_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH RECURSIVE trace_tree AS (
    -- 锚点：当前单据
    SELECT 
      id, 
      id as original_id,
      doc_no, 
      document_type, 
      status, 
      created_at, 
      business_date, 
      original_doc_id -- 用于红冲关联
    FROM inventory_documents WHERE id = p_doc_id
    
    UNION ALL

    -- 向溯源：查找被引用的原始单据
    SELECT 
      d.id,
      t.id as original_id,
      d.doc_no,
      d.document_type,
      d.status,
      d.created_at,
      d.business_date,
      d.original_doc_id
    FROM inventory_documents d
    INNER JOIN trace_tree t ON d.id = t.original_doc_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'doc_no', doc_no,
    'type', document_type,
    'status', status,
    'date', business_date
  )) INTO v_result FROM trace_tree;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;;
