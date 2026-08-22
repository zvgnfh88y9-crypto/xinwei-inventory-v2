import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const ALL_ROLES = new Set(['admin', 'inv_manager', 'staff']);
const MANAGER_ROLES = new Set(['admin', 'inv_manager']);
const ADMIN_ROLES = new Set(['admin']);

const STAFF_ACTIONS = new Set([
  'list_source_docs', 'create_source_doc', 'get_source_doc', 'update_ocr_result', 'update_source_doc',
  'save_alias', 'check_duplication', 'list_sales_orders', 'create_sales_order', 'list_production_orders',
  'match_sku', 'list_balances', 'get_trace_chain', 'list_partners', 'list_products', 'report_error'
]);

const MANAGER_ACTIONS = new Set([
  ...STAFF_ACTIONS,
  'lock_inventory', 'create_production_order', 'issue_materials', 'complete_production',
  'list_receipts', 'create_inspection', 'ship_sales_order', 'confirm_shipment_delivery', 'list_exceptions'
]);

const ADMIN_ACTIONS = new Set([
  ...MANAGER_ACTIONS,
  'delete_source_doc'
]);

const res = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' }
});

const text = (value: unknown, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const permittedActionsFor = (role: string) => {
  if (ADMIN_ROLES.has(role)) return ADMIN_ACTIONS;
  if (MANAGER_ROLES.has(role)) return MANAGER_ACTIONS;
  return STAFF_ACTIONS;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return res({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) return res({ error: 'Server configuration is incomplete' }, 500);

  const authorization = req.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return res({ error: 'Authentication required' }, 401);

  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = match[1];
  const { data: { user }, error: authErr } = await db.auth.getUser(token);
  if (authErr || !user) return res({ error: 'Invalid authentication token' }, 401);

  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('role, display_name, is_disabled')
    .eq('id', user.id)
    .single();
  if (profileError || !profile || !ALL_ROLES.has(profile.role)) return res({ error: 'Profile or role is not configured' }, 403);
  if (profile.is_disabled) return res({ error: '您的账号已被禁用，请联系管理员。' }, 403);

  let payload: Record<string, any>;
  try {
    payload = await req.json();
  } catch {
    return res({ error: 'Invalid JSON payload' }, 400);
  }
  const action = text(payload.action);
  if (!action) return res({ error: 'action 不能为空' }, 400);
  if (!permittedActionsFor(profile.role).has(action)) return res({ error: '当前角色无权执行此操作' }, 403);

  const actorName = profile.display_name || user.email || '';
  const isManager = MANAGER_ROLES.has(profile.role);
  const canEditSourceDocument = async (id: string) => {
    const { data, error } = await db.from('v2_source_documents').select('id, uploader_id').eq('id', id).maybeSingle();
    if (error || !data) return { ok: false, status: 404, error: '原始单据不存在' };
    if (!isManager && data.uploader_id !== user.id) return { ok: false, status: 403, error: '普通员工只能修改自己上传的原始单据' };
    return { ok: true, document: data };
  };
  const logAudit = async (actionType: string, resourceType: string, resourceId: string, detail: string) => {
    const { error } = await db.from('system_audit_log').insert({
      actor_id: user.id,
      actor_name: actorName,
      action_type: actionType,
      resource_type: resourceType,
      resource_id: resourceId,
      detail
    });
    if (error) console.error('[wms-audit]', error.message);
  };

  if (action === 'list_source_docs') {
    let query = db.from('v2_source_documents').select('*').order('created_at', { ascending: false });
    if (!isManager) query = query.eq('uploader_id', user.id);
    const status = text(payload.status);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.limit(200);
    if (error) return res({ error: error.message }, 500);
    return res({ documents: data || [] });
  }

  if (action === 'create_source_doc') {
    const fileUrl = text(payload.file_url);
    const fileHash = text(payload.file_hash);
    if (!fileUrl || !fileHash) return res({ error: '文件路径和哈希不能为空' }, 400);
    const { data: duplicate } = await db.from('v2_source_documents').select('id').eq('file_hash', fileHash).maybeSingle();
    if (duplicate) return res({ error: '文件已存在，请勿重复上传', duplicateId: duplicate.id }, 409);

    const { data, error } = await db.from('v2_source_documents').insert({
      file_url: fileUrl,
      file_hash: fileHash,
      file_name: text(payload.file_name),
      source_channel: text(payload.source_channel, 'manual_upload'),
      uploader_id: user.id,
      status: 'pending_ocr'
    }).select('*').single();
    if (error) return res({ error: error.message }, 400);
    await logAudit('create_source_doc', 'source_document', data.id, `上传原始单据 ${text(payload.file_name, data.id)}`);
    return res({ document: data });
  }

  if (action === 'check_duplication') {
    const hash = text(payload.hash);
    if (!hash) return res({ duplicate: false });
    const { data, error } = await db.from('v2_source_documents').select('id, status, created_at').eq('file_hash', hash).maybeSingle();
    if (error) return res({ error: error.message }, 500);
    return res({ duplicate: Boolean(data), document: data || null });
  }

  if (action === 'get_source_doc') {
    const id = text(payload.id);
    const access = await canEditSourceDocument(id);
    if (!access.ok) return res({ error: access.error }, access.status);
    const { data, error } = await db.from('v2_source_documents').select('*').eq('id', id).single();
    if (error) return res({ error: error.message }, 404);
    return res({ document: data });
  }

  if (action === 'update_ocr_result') {
    const id = text(payload.id);
    const access = await canEditSourceDocument(id);
    if (!access.ok) return res({ error: access.error }, access.status);
    const updates = {
      raw_ocr_text: text(payload.raw_text),
      structured_data: payload.structured_data ?? {},
      status: text(payload.status, 'pending_match'),
      doc_type: text(payload.doc_type),
      confidence: numberValue(payload.confidence)
    };
    const { data, error } = await db.from('v2_source_documents').update(updates).eq('id', id).select('*').single();
    if (error) return res({ error: error.message }, 400);
    await logAudit('update_ocr_result', 'source_document', id, '更新 OCR 识别结果');
    return res({ document: data });
  }

  if (action === 'update_source_doc') {
    const id = text(payload.id);
    const access = await canEditSourceDocument(id);
    if (!access.ok) return res({ error: access.error }, access.status);
    const requested = payload.updates && typeof payload.updates === 'object' ? payload.updates : {};
    const allowedKeys = new Set(['status', 'doc_type', 'confidence', 'structured_data', 'raw_ocr_text', 'source_channel']);
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(requested)) {
      if (allowedKeys.has(key)) updates[key] = value;
    }
    if (!id || Object.keys(updates).length === 0) return res({ error: '没有可更新的字段' }, 400);
    const { data, error } = await db.from('v2_source_documents').update(updates).eq('id', id).select('*').single();
    if (error) return res({ error: error.message }, 400);
    await logAudit('update_source_doc', 'source_document', id, `更新单据状态/复核字段：${Object.keys(updates).join(', ')}`);
    return res({ document: data });
  }

  if (action === 'save_alias') {
    const skuCode = text(payload.sku_code);
    const aliasName = text(payload.alias_name);
    if (!skuCode || !aliasName) return res({ error: 'SKU 和别名不能为空' }, 400);
    const { data, error } = await db.from('v2_product_aliases').upsert({
      sku_code: skuCode,
      alias_name: aliasName,
      partner_id: payload.partner_id || null,
      alias_type: text(payload.alias_type, 'ocr_raw'),
      is_verified: true
    }, { onConflict: 'sku_code,alias_name' }).select('*').single();
    if (error) return res({ error: error.message }, 400);
    return res({ alias: data });
  }

  if (action === 'list_sales_orders') {
    const { data, error } = await db.from('v2_sales_orders')
      .select('*, v2_business_partners(name), v2_sales_order_lines(*, v2_production_orders(id, order_no, plan_qty, actual_qty, scrap_qty, status)), v2_shipments(*, v2_shipment_lines(*))')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res({ error: error.message }, 500);
    return res({ orders: data || [] });
  }

  if (action === 'create_sales_order') {
    const order = payload.order || {};
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!order.customer_id || lines.length === 0) return res({ error: '客户和订单明细不能为空' }, 400);
    if (lines.some((line: any) => !text(line.sku_code) || numberValue(line.quantity) <= 0)) return res({ error: '订单明细存在无效 SKU 或数量' }, 400);
    const skuSet = new Set(lines.map((line: any) => text(line.sku_code)));
    if (skuSet.size !== lines.length) return res({ error: '同一销售订单中请合并相同 SKU，避免重复排产/锁库' }, 400);

    const { data: saved, error } = await db.from('v2_sales_orders').insert({
      order_no: `SO-${Date.now()}`,
      customer_id: order.customer_id,
      sales_person: text(order.sales_person),
      due_date: order.due_date || null,
      status: 'confirmed',
      created_by: user.id
    }).select('*').single();
    if (error || !saved) return res({ error: error?.message || '创建销售订单失败' }, 400);

    const lineRows = lines.map((line: any) => ({
      order_id: saved.id,
      sku_code: text(line.sku_code),
      quantity: numberValue(line.quantity),
      unit: text(line.unit, '条'),
      unit_price: Math.max(0, numberValue(line.unit_price))
    }));
    const { error: lineError } = await db.from('v2_sales_order_lines').insert(lineRows);
    if (lineError) {
      await db.from('v2_sales_orders').delete().eq('id', saved.id);
      return res({ error: '订单明细保存失败，已回滚订单: ' + lineError.message }, 400);
    }
    await logAudit('create_sales_order', 'sales_order', saved.id, `创建销售订单 ${saved.order_no}`);
    return res({ order: saved });
  }

  if (action === 'lock_inventory') {
    const { data, error } = await db.rpc('v2_lock_inventory', {
      p_plan_id: text(payload.planId),
      p_warehouse: text(payload.warehouse, '主仓库')
    });
    if (error) return res({ error: error.message }, 400);
    await logAudit('lock_inventory', 'inventory_plan', text(payload.planId), '按计划锁定库存');
    return res({ success: true, ...(data || {}) });
  }

  if (action === 'ship_sales_order') {
    const orderId = text(payload.orderId);
    if (!orderId) return res({ error: '销售订单 ID 不能为空' }, 400);
    const { data, error } = await db.rpc('v2_ship_sales_order', {
      p_order_id: orderId,
      p_warehouse: text(payload.warehouse, '主仓库'),
      p_actor_id: user.id
    });
    if (error) return res({ error: error.message }, 400);
    await logAudit('ship_sales_order', 'sales_order', orderId, `销售订单出库：${data?.shipment_no || ''}`);
    return res({ success: true, ...(data || {}) });
  }

  if (action === 'confirm_shipment_delivery') {
    const shipmentId = text(payload.shipmentId);
    if (!shipmentId) return res({ error: '出货单 ID 不能为空' }, 400);
    const { data, error } = await db.rpc('v2_confirm_shipment_delivery', {
      p_shipment_id: shipmentId,
      p_actor_id: user.id
    });
    if (error) return res({ error: error.message }, 400);
    await logAudit('confirm_shipment_delivery', 'shipment', shipmentId, '确认客户签收');
    return res({ success: true, ...(data || {}) });
  }

  if (action === 'list_production_orders') {
    const { data, error } = await db.from('v2_production_orders')
      .select('*, v2_production_bom_lines(*), v2_sales_orders(order_no), v2_sales_order_lines(id, sku_code, quantity, shipped_qty, locked_qty)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res({ error: error.message }, 500);
    return res({ orders: data || [] });
  }

  if (action === 'create_production_order') {
    const order = payload.order || {};
    const bom = Array.isArray(payload.bom) ? payload.bom : [];
    const skuCode = text(order.sku_code);
    const planQty = numberValue(order.plan_qty);
    let salesOrderId = text(order.sales_order_id) || null;
    const salesOrderLineId = text(order.sales_order_line_id) || null;
    if (!skuCode || planQty <= 0) return res({ error: '成品 SKU 和计划数量必须有效' }, 400);

    if (salesOrderLineId) {
      const { data: salesLine, error: salesLineError } = await db.from('v2_sales_order_lines')
        .select('id, order_id, sku_code, quantity, shipped_qty, locked_qty')
        .eq('id', salesOrderLineId)
        .single();
      if (salesLineError || !salesLine) return res({ error: '关联销售订单明细不存在' }, 400);
      if (salesLine.sku_code !== skuCode) return res({ error: '生产 SKU 必须与关联销售订单明细一致' }, 400);
      if (salesOrderId && salesLine.order_id !== salesOrderId) return res({ error: '销售订单与订单明细不匹配' }, 400);
      salesOrderId = salesLine.order_id;

      const { data: existingProduction, error: productionReadError } = await db.from('v2_production_orders')
        .select('plan_qty, actual_qty, scrap_qty, status')
        .eq('sales_order_line_id', salesOrderLineId)
        .in('status', ['draft', 'in_progress']);
      if (productionReadError) return res({ error: productionReadError.message }, 400);
      const openProductionQty = (existingProduction || []).reduce((sum: number, item: any) => (
        sum + Math.max(0, numberValue(item.plan_qty) - numberValue(item.actual_qty) - numberValue(item.scrap_qty))
      ), 0);
      const unplannedShortage = Math.max(0, numberValue(salesLine.quantity) - numberValue(salesLine.shipped_qty) - numberValue(salesLine.locked_qty) - openProductionQty);
      if (unplannedShortage <= 0) return res({ error: '该销售订单明细当前没有待排产缺口' }, 409);
      if (planQty > unplannedShortage) return res({ error: `计划数量超过当前待排产缺口 ${unplannedShortage}` }, 409);
    }

    const { data: saved, error } = await db.from('v2_production_orders').insert({
      order_no: `PO-${Date.now()}`,
      sales_order_id: salesOrderId,
      sales_order_line_id: salesOrderLineId,
      sku_code: skuCode,
      plan_qty: planQty,
      workshop: text(order.workshop),
      due_date: order.due_date || null,
      status: 'draft',
      created_by: user.id
    }).select('*').single();
    if (error || !saved) return res({ error: error?.message || '创建生产工单失败' }, 400);

    if (bom.length > 0) {
      const bomRows = bom.map((item: any) => ({
        production_id: saved.id,
        material_sku: text(item.sku),
        standard_qty: numberValue(item.qty),
        unit: text(item.unit, '条')
      }));
      const { error: bomError } = await db.from('v2_production_bom_lines').insert(bomRows);
      if (bomError) {
        await db.from('v2_production_orders').delete().eq('id', saved.id);
        return res({ error: 'BOM 保存失败，已回滚工单: ' + bomError.message }, 400);
      }
    }
    if (salesOrderId) {
      const { error: refreshError } = await db.rpc('v2_refresh_sales_order_status', { p_order_id: salesOrderId });
      if (refreshError) console.error('[sales-status-refresh]', refreshError.message);
    }
    await logAudit('create_production_order', 'production_order', saved.id, `创建生产工单 ${saved.order_no}${salesOrderId ? '，关联销售订单' : ''}`);
    return res({ order: saved });
  }

  if (action === 'issue_materials') {
    const productionId = text(payload.productionId);
    const { data, error } = await db.rpc('v2_issue_production_materials', {
      p_production_id: productionId,
      p_warehouse: text(payload.warehouse, '主仓库'),
      p_actor_id: user.id
    });
    if (error) return res({ error: error.message }, 400);
    await logAudit('issue_materials', 'production_order', productionId, '生产领料');
    return res({ success: true, ...(data || {}) });
  }

  if (action === 'complete_production') {
    const productionId = text(payload.productionId);
    const passQty = numberValue(payload.passQty);
    const failQty = Math.max(0, numberValue(payload.failQty));
    if (passQty < 0) return res({ error: '合格数量不能为负数' }, 400);
    const { data, error } = await db.rpc('v2_complete_production', {
      p_production_id: productionId,
      p_pass_qty: passQty,
      p_fail_qty: failQty,
      p_warehouse: text(payload.warehouse, '主仓库'),
      p_actor_id: user.id
    });
    if (error) return res({ error: error.message }, 400);
    await logAudit('complete_production', 'production_order', productionId, `生产完工：合格 ${passQty}，不良 ${failQty}`);
    return res({ success: true, ...(data || {}) });
  }

  if (action === 'match_sku') {
    const alias = text(payload.alias);
    if (!alias) return res({ matches: [] });
    const { data, error } = await db.from('v2_product_aliases')
      .select('sku_code, v2_product_main(*)')
      .ilike('alias_name', `%${alias}%`)
      .limit(20);
    if (error) return res({ error: error.message }, 500);
    return res({ matches: data || [] });
  }

  if (action === 'list_balances') {
    const { data, error } = await db.from('v2_inventory_balances').select('*, v2_product_main(*)').limit(1000);
    if (error) return res({ error: error.message }, 500);
    return res({ balances: data || [] });
  }

  if (action === 'list_receipts') {
    const { data, error } = await db.from('v2_warehouse_receipts')
      .select('*, v2_warehouse_receipt_lines(*)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res({ error: error.message }, 500);
    return res({ receipts: data || [] });
  }

  if (action === 'create_inspection') {
    const receiptId = text(payload.receiptId);
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!receiptId || lines.length === 0) return res({ error: '收货单和质检明细不能为空' }, 400);
    const { data: receipt, error: receiptError } = await db.from('v2_warehouse_receipts')
      .select('id, status')
      .eq('id', receiptId)
      .single();
    if (receiptError || !receipt) return res({ error: '待检收货单不存在' }, 404);
    if (receipt.status !== 'received') return res({ error: `收货单当前状态为 ${receipt.status}，不能重复质检` }, 409);
    if (lines.some((line: any) => numberValue(line.pass_qty) < 0 || numberValue(line.fail_qty) < 0)) {
      return res({ error: '质检数量不能为负数' }, 400);
    }

    const { data: saved, error } = await db.from('v2_quality_inspections').insert({
      inspect_no: `QC-${Date.now()}`,
      receipt_id: receiptId,
      inspected_by: user.id,
      status: 'draft',
      notes: text(payload.notes)
    }).select('*').single();
    if (error || !saved) return res({ error: error?.message || '创建质检单失败' }, 400);

    const lineRows = lines.map((line: any) => ({
      inspect_id: saved.id,
      receipt_line_id: line.receipt_line_id,
      sku_code: text(line.sku_code),
      pass_qty: numberValue(line.pass_qty),
      fail_qty: Math.max(0, numberValue(line.fail_qty)),
      fail_reason: text(line.fail_reason)
    }));
    const { error: lineError } = await db.from('v2_quality_inspection_lines').insert(lineRows);
    if (lineError) {
      await db.from('v2_quality_inspections').delete().eq('id', saved.id);
      return res({ error: '质检明细保存失败，已回滚质检单: ' + lineError.message }, 400);
    }

    const { error: finalizeError } = await db.rpc('v2_finalize_inspection', {
      p_inspect_id: saved.id,
      p_warehouse: text(payload.warehouse, '主仓库'),
      p_actor_id: user.id
    });
    if (finalizeError) {
      await db.from('v2_quality_inspections').delete().eq('id', saved.id);
      return res({ error: '质检库存划转失败，已回滚质检单: ' + finalizeError.message }, 400);
    }

    await logAudit('create_inspection', 'quality_inspection', saved.id, `完成质检 ${saved.inspect_no}`);
    return res({ inspection: saved });
  }

  if (action === 'get_trace_chain') {
    const { data, error } = await db.rpc('v2_get_document_trace_chain', { p_doc_id: text(payload.docId) });
    if (error) return res({ error: error.message }, 400);
    return res({ chain: data || [] });
  }

  // --- Helper: Simple Fuzzy Matching for Chinese Names ---
  const getSimilarity = (s1: string, s2: string) => {
    const set1 = new Set(s1.split(''));
    const set2 = new Set(s2.split(''));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  };

  if (action === 'list_exceptions') {
    const [ocrFailedResult, duplicatedResult, qcFailedResult, tempSkuResult, negativeStockResult, docsResult, partnersResult] = await Promise.all([
      db.from('v2_source_documents').select('*').eq('status', 'failed'),
      db.from('v2_source_documents').select('*').eq('status', 'duplicated'),
      db.from('v2_quality_inspection_lines').select('*, v2_quality_inspections(*)').gt('fail_qty', 0),
      db.from('inventory_products').select('sku, name, category, created_at').eq('category', '待完善资料'),
      db.from('inventory_products').select('sku, name, available_stock, unit').lt('available_stock', 0),
      db.from('inventory_documents').select('partner_name'),
      db.from('v2_business_partners').select('id, name')
    ]);

    const firstError = ocrFailedResult.error || duplicatedResult.error || qcFailedResult.error || tempSkuResult.error || negativeStockResult.error || docsResult.error || partnersResult.error;
    if (firstError) return res({ error: firstError.message }, 500);

    // 计算未知单位与相似匹配
    const knownNames = new Set((partnersResult.data || []).map((p: any) => p.name));
    const allDocPartnerNames = [...new Set((docsResult.data || []).map((d: any) => text(d.partner_name)).filter(n => n && n !== '内部' && !['内部作业', '自动导入'].includes(n)))];
    
    const partnerExceptions = allDocPartnerNames
      .filter(name => !knownNames.has(name))
      .map(unmatchedName => {
        const suggestions = (partnersResult.data || [])
          .map((p: any) => ({ id: p.id, name: p.name, score: getSimilarity(unmatchedName, p.name) }))
          .filter(s => s.score > 0.3)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        return { unmatchedName, suggestions };
      });

    return res({
      ocr_failed: ocrFailedResult.data || [],
      duplicated: duplicatedResult.data || [],
      qc_discrepancies: qcFailedResult.data || [],
      temporary_skus: tempSkuResult.data || [],
      negative_stock: negativeStockResult.data || [],
      partner_exceptions: partnerExceptions
    });
  }

  if (action === 'list_partners') {
    const { data, error } = await db.from('v2_business_partners').select('*').order('name').limit(500);
    if (error) return res({ error: error.message }, 500);
    return res({ partners: data || [] });
  }

  if (action === 'list_products') {
    const { data, error } = await db.from('v2_product_main').select('*').order('created_at', { ascending: false }).limit(1000);
    if (error) return res({ error: error.message }, 500);
    return res({ products: data || [] });
  }

  if (action === 'report_error') {
    const errorId = text(payload.error_id, `ERR-${Date.now()}`);
    await db.from('system_audit_log').insert({
      actor_id: user.id,
      actor_name: actorName,
      action_type: 'frontend_crash',
      resource_type: 'error_id',
      resource_id: errorId,
      detail: JSON.stringify({
        message: text(payload.message).slice(0, 4000),
        stack: text(payload.stack).slice(0, 12000),
        page_url: text(payload.page_url).slice(0, 1000),
        user_agent: text(payload.user_agent).slice(0, 1000),
        version: text(payload.version).slice(0, 100)
      })
    });
    return res({ ok: true });
  }

  if (action === 'delete_source_doc') {
    const id = text(payload.id);
    if (!id) return res({ error: 'ID 不能为空' }, 400);
    const { data: doc, error: readError } = await db.from('v2_source_documents').select('id, file_url, status').eq('id', id).single();
    if (readError || !doc) return res({ error: '原始凭证不存在' }, 404);
    if (doc.status === 'posted') return res({ error: '已入账原始凭证禁止物理删除，请使用归档/作废流程' }, 409);

    const { error } = await db.from('v2_source_documents').delete().eq('id', id);
    if (error) return res({ error: error.message }, 500);
    if (doc.file_url) {
      const { error: storageError } = await db.storage.from('product-images').remove([doc.file_url]);
      if (storageError) console.error('[source-doc-storage-delete]', storageError.message);
    }
    await logAudit('delete_source_doc', 'source_document', id, '管理员删除未入账原始凭证');
    return res({ ok: true });
  }

  if (action === 'merge_partner') {
    if (!isManager) return res({ error: '无权限执行名称合并' }, 403);
    const oldName = text(payload.old_name);
    const standardName = text(payload.standard_name);
    if (!oldName || !standardName) return res({ error: '原始名称和标准名称不能为空' }, 400);

    // 1. 确保标准名称在 v2_business_partners 中存在 (若不存在则创建)
    const { data: partner } = await db.from('v2_business_partners').select('id').eq('name', standardName).maybeSingle();
    let partnerId = partner?.id;
    if (!partnerId) {
        const { data: created, error: createError } = await db.from('v2_business_partners').insert({
            name: standardName,
            partner_type: 'other'
        }).select('id').single();
        if (createError) return res({ error: '创建标准单位失败: ' + createError.message }, 500);
        partnerId = created.id;
    }

    // 2. 批量更新 inventory_documents 中的 partner_name
    const { error: updateError } = await db.from('inventory_documents')
        .update({ partner_name: standardName })
        .eq('partner_name', oldName);
    
    if (updateError) return res({ error: '更新单据记录失败: ' + updateError.message }, 500);

    await logAudit('merge_partner', 'business_partner', partnerId, `合并往来单位名称：${oldName} -> ${standardName}`);
    return res({ ok: true });
  }

  // 注意：run_migration / reset_system_passwords 已在第一阶段安全整改中永久移除。
  return res({ error: `Unsupported action: ${action}` }, 400);
});
