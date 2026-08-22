import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const ALLOWED_ROLES = new Set(['admin', 'inv_manager', 'warehouse_keeper', 'staff']);
const DOC_TYPES = new Set(['receipt', 'production_in', 'shipment', 'transfer_to_retail', 'retail_sale']);

const res = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' }
});
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const bearer = (request: Request) => {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return res({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const token = bearer(request);
  if (!url || !anon || !service) return res({ error: 'Server configuration is incomplete' }, 500);
  if (!token) return res({ error: 'Authentication required' }, 401);

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const auth = await userClient.auth.getUser(token);
  if (auth.error || !auth.data.user) return res({ error: 'Invalid authentication token' }, 401);

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const profileResult = await db.from('profiles').select('role, display_name, is_disabled').eq('id', auth.data.user.id).single();
  const profile = profileResult.data;
  if (profileResult.error || !profile || !ALLOWED_ROLES.has(profile.role)) return res({ error: 'Profile or role is not configured' }, 403);
  if (profile.is_disabled) return res({ error: '您的账号已被禁用，请联系管理员。' }, 403);

  let payload: Record<string, any>;
  try { payload = await request.json(); } catch { return res({ error: 'Invalid JSON payload' }, 400); }

  const action = text(payload.action);
  const uid = auth.data.user.id;
  const actor = profile.display_name || auth.data.user.email || '';
  const isAdmin = profile.role === 'admin';
  const isWarehouseKeeper = profile.role === 'warehouse_keeper' || profile.role === 'inv_manager';

  const getDoc = async (id: string) => {
    const { data } = await db.from('inventory_documents').select('id,status,created_by,submitted_by,document_type').eq('id', id).maybeSingle();
    return data;
  };
  // 仓管是复核人，不代替员工修改或删除原始申请。
  const canEditDoc = (doc: any) => Boolean(doc && (isAdmin || doc.created_by === uid));

  if (action === 'list') {
    // 员工只能查看自己的申请；仓管与管理员因审核职责可查看全量业务流水。
    const direction = text(payload.direction);
    let query = db.from('inventory_documents').select('*, inventory_document_lines(*)');
    if (profile.role === 'staff') query = query.eq('created_by', uid);
    if (direction === 'in') query = query.in('document_type', ['receipt', 'production_in']);
    else if (direction === 'out') query = query.in('document_type', ['shipment', 'retail_sale']);
    else if (direction === 'internal') query = query.eq('document_type', 'transfer_to_retail');
    const result = await query.order('business_date', { ascending: false }).order('created_at', { ascending: false }).limit(200);
    return result.error ? res({ error: result.error.message }, 500) : res({ documents: result.data || [] });
  }

  if (action === 'summary') {
    const businessDate = text(payload.business_date);
    const result = await db.from('inventory_document_lines')
      .select('quantity, inventory_documents!inner(document_type, business_date, status)')
      .eq('inventory_documents.business_date', businessDate)
      .eq('inventory_documents.status', 'posted');
    if (result.error) return res({ error: result.error.message }, 500);
    const summary = { inbound_quantity: 0, outbound_quantity: 0, line_count: result.data.length };
    result.data.forEach((line: any) => {
      const type = line.inventory_documents.document_type;
      if (['receipt', 'production_in', 'transfer_to_retail'].includes(type)) summary.inbound_quantity += Number(line.quantity || 0);
      if (['shipment', 'retail_sale'].includes(type)) summary.outbound_quantity += Number(line.quantity || 0);
    });
    return res({ summary });
  }

  if (action === 'home_summary') {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    let query = db.from('inventory_documents').select('id,doc_no,document_type,status,business_date,partner_name,created_by,submitted_by,submitted_at,warehouse_reviewed_by,warehouse_reviewed_at,approved_by,approved_at,posted_at,created_at,rejection_reason');
    if (!isAdmin && !isWarehouseKeeper) query = query.eq('created_by', uid);
    const result = await query.order('business_date', { ascending: false }).order('created_at', { ascending: false }).limit(500);
    if (result.error) return res({ error: result.error.message }, 500);
    const docs = result.data || [];
    const sameShanghaiDay = (value: string | null) => value && new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) === today;
    let counts: Record<string, number>;
    let tasks: any[];
    if (isAdmin) {
      counts = {
        final_review: docs.filter((doc: any) => doc.status === 'warehouse_approved').length,
        ready_to_post: docs.filter((doc: any) => doc.status === 'approved').length,
        posted_today: docs.filter((doc: any) => doc.status === 'posted' && sameShanghaiDay(doc.posted_at)).length,
        rejected: docs.filter((doc: any) => doc.status === 'rejected').length
      };
      tasks = docs.filter((doc: any) => ['warehouse_approved', 'approved'].includes(doc.status));
    } else if (isWarehouseKeeper) {
      counts = {
        professional_review: docs.filter((doc: any) => doc.status === 'pending' && doc.submitted_by !== uid).length,
        reviewed_today: docs.filter((doc: any) => doc.warehouse_reviewed_by === uid && sameShanghaiDay(doc.warehouse_reviewed_at)).length,
        awaiting_admin: docs.filter((doc: any) => doc.status === 'warehouse_approved').length,
        rejected: docs.filter((doc: any) => doc.status === 'rejected').length
      };
      tasks = docs.filter((doc: any) => doc.status === 'pending' && doc.submitted_by !== uid);
    } else {
      counts = {
        drafts: docs.filter((doc: any) => doc.status === 'draft').length,
        reviewing: docs.filter((doc: any) => ['pending', 'warehouse_approved'].includes(doc.status)).length,
        rejected: docs.filter((doc: any) => doc.status === 'rejected').length,
        approved: docs.filter((doc: any) => ['approved', 'posted'].includes(doc.status)).length
      };
      tasks = docs.filter((doc: any) => ['draft', 'pending', 'warehouse_approved', 'approved', 'rejected'].includes(doc.status));
    }
    const taskPriority: Record<string, number> = { rejected: 0, warehouse_approved: 1, approved: 2, pending: 3, draft: 4 };
    tasks = tasks.sort((a: any, b: any) => (taskPriority[a.status] ?? 9) - (taskPriority[b.status] ?? 9) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 6);
    return res({ summary: { role: profile.role, counts, tasks } });
  }

  if (action === 'notifications') {
    const requestedLimit = Number(payload.limit || 30);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100) : 30;
    const [result, unreadResult] = await Promise.all([
      db.from('workflow_notifications')
        .select('id,document_id,event_type,title,message,route,is_read,read_at,created_at')
        .eq('recipient_id', uid)
        .order('created_at', { ascending: false })
        .limit(limit),
      db.from('workflow_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', uid)
        .eq('is_read', false)
    ]);
    if (result.error) return res({ error: result.error.message }, 500);
    if (unreadResult.error) return res({ error: unreadResult.error.message }, 500);
    return res({ notifications: result.data || [], unread_count: unreadResult.count || 0 });
  }

  if (action === 'mark_notification_read') {
    const notificationId = text(payload.notification_id);
    if (!notificationId) return res({ error: '通知编号不能为空' }, 400);
    const result = await db.from('workflow_notifications').update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId).eq('recipient_id', uid).select('id').maybeSingle();
    if (result.error) return res({ error: result.error.message }, 400);
    return res({ ok: true });
  }

  if (action === 'mark_document_notifications_read') {
    const docId = text(payload.document_id);
    if (!docId) return res({ error: '单据编号不能为空' }, 400);
    const result = await db.from('workflow_notifications').update({ is_read: true, read_at: new Date().toISOString() })
      .eq('document_id', docId).eq('recipient_id', uid).eq('is_read', false);
    return result.error ? res({ error: result.error.message }, 400) : res({ ok: true });
  }

  if (action === 'mark_all_notifications_read') {
    const result = await db.from('workflow_notifications').update({ is_read: true, read_at: new Date().toISOString() })
      .eq('recipient_id', uid).eq('is_read', false);
    return result.error ? res({ error: result.error.message }, 400) : res({ ok: true });
  }

  if (action === 'approval_timeline') {
    const docId = text(payload.document_id);
    const doc = await getDoc(docId);
    if (!doc) return res({ error: '单据不存在' }, 404);
    if (!isAdmin && !isWarehouseKeeper && doc.created_by !== uid) return res({ error: '无权查看该单据审批记录' }, 403);
    const result = await db.from('workflow_approval_events')
      .select('id,action,from_status,to_status,actor_id,actor_role,actor_name,comment,created_at')
      .eq('document_id', docId).order('created_at', { ascending: true });
    return result.error ? res({ error: result.error.message }, 500) : res({ events: result.data || [] });
  }

  if (action === 'create' || action === 'capture') {
    const document = (payload.document || {}) as Record<string, unknown>;
    const lines = Array.isArray(payload.lines) ? payload.lines as Record<string, unknown>[] : [];
    const documentType = text(document.document_type);
    if (!DOC_TYPES.has(documentType)) return res({ error: '不支持的单据类型' }, 400);
    if (lines.some((line) => !text(line.sku) || Number(line.quantity || 0) <= 0)) return res({ error: '明细存在无效 SKU 或数量' }, 400);

    const captured = await db.from('inventory_documents').insert({
      doc_no: action === 'capture' ? text(document.doc_no, `CAPTURE-${Date.now()}`) : `DOC-${Date.now()}`,
      document_type: documentType,
      status: 'draft',
      business_date: text(document.business_date, new Date().toISOString().slice(0, 10)),
      partner_name: text(document.partner_name),
      order_no: text(document.order_no),
      notes: text(document.notes),
      inbound_person: text(document.inbound_person),
      source_file_name: text(document.source_file_name),
      source_file_type: text(document.source_file_type),
      image_path: text(document.image_path),
      created_by: uid
    }).select('*').single();
    if (captured.error || !captured.data) return res({ error: captured.error?.message || '创建单据失败' }, 400);

    if (lines.length) {
      const rows = lines.map((line) => ({
        document_id: captured.data.id,
        sku: text(line.sku),
        product_name: text(line.product_name),
        spec: text(line.spec),
        quantity: Number(line.quantity || 0),
        unit: text(line.unit, '条'),
        batch_no: text(line.batch_no),
        warehouse: text(line.warehouse),
        unit_price: Number(line.unit_price || 0)
      }));
      const insertLines = await db.from('inventory_document_lines').insert(rows);
      if (insertLines.error) {
        await db.from('inventory_documents').delete().eq('id', captured.data.id);
        return res({ error: '单据明细保存失败，已回滚单据: ' + insertLines.error.message }, 400);
      }
    }
    return res({ document: captured.data });
  }

  if (action === 'update') {
    const docId = text(payload.document_id);
    const document = (payload.document || {}) as Record<string, unknown>;
    const lines = Array.isArray(payload.lines) ? payload.lines as Record<string, unknown>[] : [];
    if (!lines.length) return res({ error: '单据至少需要一条有效明细' }, 400);
    if (lines.some((line) => !text(line.sku) || Number(line.quantity || 0) <= 0)) return res({ error: '明细存在无效 SKU 或数量' }, 400);
    const result = await db.rpc('update_inventory_document_draft_atomic', {
      p_document_id: docId,
      p_actor_id: uid,
      p_document: document,
      p_lines: lines
    });
    if (result.error) {
      const status = /单据不存在/.test(result.error.message) ? 404
        : /只有草稿|只能修改/.test(result.error.message) ? 409
          : 400;
      return res({ error: result.error.message }, status);
    }
    return res({ ok: true, result: result.data });
  }

  if (action === 'submit') {
    const docId = text(payload.document_id);
    const existing = await getDoc(docId);
    if (!existing || existing.status !== 'draft') return res({ error: '只有草稿单据可以提交' }, 409);
    if (!canEditDoc(existing)) return res({ error: '只能提交自己创建的单据' }, 403);
    const linesResult = await db.from('inventory_document_lines').select('id,sku,quantity').eq('document_id', docId);
    if (linesResult.error) return res({ error: linesResult.error.message }, 500);
    const submissionLines = linesResult.data || [];
    if (!submissionLines.length) return res({ error: '单据至少需要一条有效明细后才能提交审核' }, 400);
    if (submissionLines.some((line: any) => !text(line.sku) || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0)) {
      return res({ error: '单据存在无效 SKU 或数量，请修改明细后再提交审核' }, 400);
    }
    const result = await db.from('inventory_documents').update({ status: 'pending', submitted_by: uid, submitted_at: new Date().toISOString() }).eq('id', docId).eq('status', 'draft').select('*').single();
    return result.error ? res({ error: result.error.message }, 400) : res({ document: result.data });
  }

  if (action === 'approve_draft') {
    if (!isAdmin) return res({ error: '只有管理员可以直接审核自己创建的草稿' }, 403);
    const documentId = text(payload.document_id);
    const existing = await getDoc(documentId);
    if (!existing || existing.status !== 'draft') return res({ error: '只有草稿单据可以直接审核' }, 409);
    if (existing.created_by !== uid) return res({ error: '管理员只能直接审核自己创建的草稿' }, 403);
    const result = await db.rpc('admin_approve_own_inventory_draft', { p_document_id: documentId, p_actor_id: uid });
    return result.error ? res({ error: result.error.message }, 400) : res({ document: result.data });
  }

  if (action === 'review') {
    if (!isWarehouseKeeper) return res({ error: '只有仓管可以进行专业复核' }, 403);
    const existing = await getDoc(text(payload.document_id));
    if (!existing || existing.status !== 'pending') return res({ error: '单据当前不在仓管待审核状态' }, 409);
    if (existing.submitted_by === uid || existing.created_by === uid) return res({ error: '不能复核自己创建或提交的单据，请由其他仓管处理' }, 409);
    const approved = Boolean(payload.approved);
    const reason = text(payload.reason);
    if (!approved && !reason) return res({ error: '驳回时必须填写具体原因，便于员工修改后重新提交' }, 400);
    const result = await db.from('inventory_documents').update({
      status: approved ? 'warehouse_approved' : 'rejected',
      warehouse_reviewed_by: approved ? uid : null,
      warehouse_reviewed_at: approved ? new Date().toISOString() : null,
      warehouse_review_note: reason,
      rejected_by: approved ? null : uid,
      rejection_reason: approved ? '' : reason,
      approved_at: null,
      updated_at: new Date().toISOString()
    }).eq('id', text(payload.document_id)).eq('status', 'pending').select('*').single();
    return result.error ? res({ error: result.error.message }, 400) : res({ document: result.data });
  }

  if (action === 'final_review') {
    if (!isAdmin) return res({ error: '只有管理员可以进行最终审核' }, 403);
    const approved = Boolean(payload.approved);
    const reason = text(payload.reason);
    if (!approved && !reason) return res({ error: '终审驳回时必须填写具体原因，便于员工修改后重新提交' }, 400);
    const result = await db.from('inventory_documents').update({
      status: approved ? 'approved' : 'rejected', approved_by: approved ? uid : null,
      rejected_by: approved ? null : uid, rejection_reason: approved ? '' : reason,
      approved_at: approved ? new Date().toISOString() : null, updated_at: new Date().toISOString()
    }).eq('id', text(payload.document_id)).eq('status', 'warehouse_approved').select('*').single();
    return result.error ? res({ error: result.error.message }, 400) : res({ document: result.data });
  }

  if (action === 'reopen') {
    if (!isAdmin) return res({ error: '只有管理员可以退回草稿' }, 403);
    const reason = text(payload.reason);
    if (!reason) return res({ error: '退回草稿时必须填写具体原因' }, 400);
    const result = await db.from('inventory_documents').update({
      status: 'draft',
      approved_by: null,
      approved_at: null,
      rejected_by: uid,
      rejection_reason: reason,
      updated_at: new Date().toISOString()
    }).eq('id', text(payload.document_id)).eq('status', 'approved').select('*').single();
    return result.error ? res({ error: result.error.message }, 400) : res({ document: result.data });
  }

  if (action === 'revise_rejected') {
    const docId = text(payload.document_id);
    const existing = await getDoc(docId);
    if (!existing || existing.status !== 'rejected') return res({ error: '只有已驳回单据可以退回草稿修改' }, 409);
    if (!isAdmin && existing.created_by !== uid) return res({ error: '只能修改自己创建的被驳回单据' }, 403);
    const result = await db.from('inventory_documents').update({
      status: 'draft',
      submitted_by: null,
      submitted_at: null,
      warehouse_reviewed_by: null,
      warehouse_reviewed_at: null,
      warehouse_review_note: '',
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejection_reason: '',
      updated_at: new Date().toISOString()
    }).eq('id', docId).eq('status', 'rejected').select('*').single();
    return result.error ? res({ error: result.error.message }, 400) : res({ document: result.data });
  }

  if (action === 'post') {
    if (!isAdmin) return res({ error: '只有管理员可以最终入账' }, 403);
    const documentId = text(payload.document_id);
    const documentResult = await db.from('inventory_documents')
      .select('document_type,status,inventory_document_lines(sku,product_name,unit)')
      .eq('id', documentId).single();
    if (documentResult.error) return res({ error: documentResult.error.message }, 400);
    if (documentResult.data.status !== 'approved') return res({ error: '只有管理员终审通过的单据才能确认入账或出库' }, 409);

    // 入库及主仓出库允许先使用临时 SKU。盘点期间，出库单可先建立零库存产品，
    // 随后的数据库记账函数会形成负库存；管理员以后可补正式 SKU 和盘点数量。
    if (['receipt', 'production_in', 'shipment'].includes(documentResult.data.document_type)) {
      const lines = documentResult.data.inventory_document_lines || [];
      for (const line of lines) {
        const existing = await db.from('inventory_products').select('sku').ilike('sku', text(line.sku)).maybeSingle();
        if (existing.error) return res({ error: existing.error.message }, 500);
        if (!existing.data) {
          const rawName = text(line.product_name, text(line.sku));
          const specMatch = rawName.match(/(\d+(?:\.\d+)?\s*(?:米|mm|cm)(?:\s*[×xX*]\s*\d+(?:\.\d+)?\s*(?:米|mm|cm))+)/i);
          const detectedSpec = specMatch?.[1]?.replace(/\s+/g, '') || '';
          const cleanName = detectedSpec ? rawName.replace(specMatch![0], '').trim() : rawName;
          const created = await db.from('inventory_products').insert({
            sku: text(line.sku),
            name: cleanName,
            spec: detectedSpec,
            category: '待完善资料',
            unit: text(line.unit, '件'),
            stock: 0,
            available_stock: 0,
            status: 'Out of Stock',
            source: documentResult.data.document_type === 'shipment'
              ? '出库单临时建档（负库存待盘点）'
              : '入库单临时建档',
            created_by: uid,
            updated_by: uid
          });
          if (created.error) return res({ error: `临时产品建档失败：${created.error.message}` }, 400);
        }
      }
    }
    const result = await db.rpc('post_inventory_document', { p_document_id: documentId, p_actor_id: uid, p_actor_name: actor });
    if (result.error) return res({ error: result.error.message }, 400);
    if (result.data?.error) return res({ error: result.data.error }, 400);
    return res({ result: result.data });
  }

  if (action === 'void') {
    if (!isAdmin) return res({ error: '只有管理员可以红冲作废' }, 403);
    const result = await db.rpc('void_inventory_document', {
      p_document_id: text(payload.document_id),
      p_actor_id: uid,
      p_reason: text(payload.reason, '红冲作废')
    });
    if (result.error) return res({ error: result.error.message }, 400);
    if (result.data?.error) return res({ error: result.data.error }, 400);
    return res({ success: true, ...(result.data || {}) });
  }

  if (action === 'delete') {
    const docId = text(payload.document_id);
    const doc = await getDoc(docId);
    if (!doc) return res({ error: '单据不存在' }, 404);
    if (doc.status !== 'draft') return res({ error: '只有草稿单据可以物理删除；已提交单据请走审批或作废流程' }, 409);
    if (!canEditDoc(doc)) return res({ error: '只能删除自己创建的草稿单据' }, 403);
    const result = await db.from('inventory_documents').delete().eq('id', docId).eq('status', 'draft').select('id').maybeSingle();
    if (!result.error && !result.data) return res({ error: '单据状态已变化，未执行删除，请刷新后重试' }, 409);
    return result.error ? res({ error: result.error.message }, 500) : res({ ok: true });
  }

  if (action === 'delete_bulk') {
    const ids = [...new Set(Array.isArray(payload.ids) ? payload.ids.map((id: unknown) => text(id)).filter(Boolean) : [])];
    if (!ids.length) return res({ ok: true });
    const { data: docs, error } = await db.from('inventory_documents').select('id,status,created_by').in('id', ids);
    if (error) return res({ error: error.message }, 500);
    if ((docs || []).length !== ids.length) return res({ error: '部分所选单据不存在，请刷新后重新选择' }, 404);
    const forbidden = (docs || []).filter((doc: any) => doc.status !== 'draft' || (!isAdmin && doc.created_by !== uid));
    if (forbidden.length) return res({ error: '批量物理删除仅限有权限的草稿单据' }, 403);
    const result = await db.from('inventory_documents').delete().in('id', ids).eq('status', 'draft').select('id');
    if (!result.error && (result.data || []).length !== ids.length) return res({ error: '部分单据状态已变化，仅草稿被删除，请刷新确认' }, 409);
    return result.error ? res({ error: result.error.message }, 500) : res({ ok: true });
  }

  if (action === 'movements') {
    const docId = text(payload.document_id);
    const doc = await getDoc(docId);
    if (!doc) return res({ error: '单据不存在' }, 404);
    if (!isAdmin && !isWarehouseKeeper && doc.created_by !== uid && doc.status !== 'posted') return res({ error: '无权查看该单据流水' }, 403);
    const result = await db.from('inventory_movements').select('*').eq('document_id', docId).order('created_at', { ascending: true });
    return result.error ? res({ error: result.error.message }, 500) : res({ movements: result.data || [] });
  }

  return res({ error: `Unsupported action: ${action}` }, 400);
});
