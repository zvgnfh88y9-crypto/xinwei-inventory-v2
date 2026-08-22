import { supabase } from './supabaseClient';
import { getUserErrorMessage } from './userError';

const invoke = async (action, payload = {}) => {
  if (!supabase) throw new Error('Supabase 尚未配置');
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('服务响应超时，请检查网络后重试')), 15000);
  });
  const { data, error } = await Promise.race([
    supabase.functions.invoke('wms-v2-action', { body: { action, ...payload } }),
    timeout
  ]);
  if (error) throw new Error(getUserErrorMessage(error.message, 'WMS V2 接口请求失败'));
  if (data?.error) throw new Error(getUserErrorMessage(data.error, 'WMS V2 接口请求失败'));
  return data;
};

// --- Single Source of Truth for Statuses ---
export const DOC_STATUSES = {
  pending_ocr: '待识别',
  pending_classify: '待分类',
  pending_match: '待匹配',
  pending_review: '待复核',
  generated: '已生成业务单据',
  posted: '已入账',
  duplicated: '疑似重复',
  failed: '识别失败',
  rejected: '已驳回',
  archived: '已归档'
};

export const INV_STATUSES = {
  available: '可用',
  locked: '已锁定',
  inspecting: '待检',
  wip: '生产在制',
  subcontract: '委外加工',
  transit: '在途',
  defective: '不良品',
  shipped: '已发货待签收'
};

export const getSourceDocument = (id) => invoke('get_source_doc', { id });
export const updateSourceDocument = (id, updates) => invoke('update_source_doc', { id, updates });
export const updateOcrResult = (id, params) => invoke('update_ocr_result', { id, ...params });
export const saveProductAlias = (params) => invoke('save_alias', params);
export const listPartners = () => invoke('list_partners');

// --- API Methods ---
export const listExceptions = () => invoke('list_exceptions');
export const checkDuplication = (hash) => invoke('check_duplication', { hash });

export const listReceipts = () => invoke('list_receipts');
export const finalizeInspection = (receiptId, lines, notes) => invoke('create_inspection', { receiptId, lines, notes });
export const getTraceChain = (docId) => invoke('get_trace_chain', { docId });

export const listProductionOrders = () => invoke('list_production_orders');
export const createProductionOrder = (order, bom) => invoke('create_production_order', { order, bom });
export const issueMaterials = (productionId, warehouse) => invoke('issue_materials', { productionId, warehouse });
export const completeProduction = (productionId, passQty, failQty, warehouse) => invoke('complete_production', { productionId, passQty, failQty, warehouse });

export const reportError = (params) => invoke('report_error', params);

export const listSalesOrders = () => invoke('list_sales_orders');
export const createSalesOrder = (order, lines) => invoke('create_sales_order', { order, lines });
export const lockInventoryForPlan = (planId, warehouse) => invoke('lock_inventory', { planId, warehouse });
export const shipSalesOrder = (orderId, warehouse) => invoke('ship_sales_order', { orderId, warehouse });
export const confirmShipmentDelivery = (shipmentId) => invoke('confirm_shipment_delivery', { shipmentId });
export const deleteSourceDocument = (id) => invoke('delete_source_doc', { id });

export const listSourceDocuments = (params) => invoke('list_source_docs', params);
export const uploadSourceDocument = async (file, channel) => {
  if (!supabase) throw new Error('Supabase 尚未配置');
  const fileHash = await computeFileHash(file);
  const duplicate = await checkDuplication(fileHash);
  if (duplicate?.duplicate) throw new Error('文件已存在，请勿重复上传');

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('登录状态已失效，请重新登录');

  const safeName = (file.name || 'source-file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `source-docs/${userData.user.id}/${Date.now()}-${safeName}`;
  const { data: upload, error: uploadErr } = await supabase.storage.from('product-images').upload(filePath, file, {
    upsert: false,
    contentType: file.type || undefined
  });
  if (uploadErr) throw new Error(uploadErr.message || '原始凭证上传失败');

  try {
    return await invoke('create_source_doc', {
      file_url: upload.path,
      file_hash: fileHash,
      source_channel: channel,
      file_name: file.name
    });
  } catch (error) {
    // 数据库登记失败时尽量清理孤立文件；删除权限由后端保留，客户端仅提示失败。
    throw error;
  }
};

export const matchSkuAlias = (alias) => invoke('match_sku', { alias });
export const listInventoryBalances = () => invoke('list_balances');
export const listProductsMain = () => invoke('list_products');
export const mergePartner = (oldName, standardName) => invoke('merge_partner', { old_name: oldName, standard_name: standardName });

// Helper to compute SHA-256 hash
async function computeFileHash(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
