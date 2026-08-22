import { supabase } from './supabaseClient';
import { getUserErrorMessage } from './userError';

function requireClient() {
  if (!supabase) throw new Error('Supabase 尚未配置，请检查本地环境变量。');
  return supabase;
}

async function invoke(action, payload = {}) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('inventory-action', {
    body: { action, ...payload }
  });
  if (error) {
    console.error(`[inventoryApi] Action ${action} failed:`, error);
    let responseBody = null;
    if (error.context?.clone) {
      try {
        responseBody = await error.context.clone().json();
      } catch {
        responseBody = null;
      }
    }
    const contextBody = error.context?.body;
    const contextMessage = responseBody?.error
      || responseBody?.message
      || contextBody?.error
      || contextBody?.message;
    throw new Error(getUserErrorMessage(contextMessage || error, '库存服务请求失败，请稍后重试。'));
  }
  if (data?.error) throw new Error(getUserErrorMessage(data.error, '库存服务请求失败，请稍后重试。'));
  return data;
}

export const signIn = async (email, password) => {
  const client = requireClient();
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(getUserErrorMessage(error, '登录失败，请稍后重试。'));
    return data.session;
  } catch (err) {
    if (err.message === 'Failed to fetch') {
      throw new Error('网络连接失败：无法连接至 Supabase 云端服务器。请检查您的互联网连接或防火墙设置。');
    }
    throw err;
  }
};

export const signOut = async () => {
  if (supabase) await supabase.auth.signOut();
};

export const sendPasswordReset = async (email) => {
  const client = requireClient();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname}#/`
  });
  if (error) throw new Error(getUserErrorMessage(error, '密码重置邮件发送失败，请稍后重试。'));
};

export const getSessionProfile = async () => {
  const client = requireClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) {
    // 手机浏览器可能长期保留已被服务端撤销的 refresh token。
    // 这类会话无法恢复，直接清除本机缓存并回到登录页。
    if (/invalid.*token|refresh.*token|jwt.*expired/i.test(sessionError.message || '')) {
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
      return null;
    }
    throw new Error(getUserErrorMessage(sessionError, '无法读取登录状态，请稍后重试。'));
  }
  if (!sessionData.session) return null;

  const { data: verifiedUser, error: userError } = await client.auth.getUser();
  if (userError || !verifiedUser.user) {
    const message = userError?.message || 'Invalid authentication token';
    if (/invalid.*token|refresh.*token|jwt.*expired|user.*not.*found/i.test(message)) {
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
      return null;
    }
    throw new Error(getUserErrorMessage(message, '登录状态验证失败，请重新登录。'));
  }
  let profile;
  try {
    profile = await invoke('profile');
  } catch (edgeError) {
    // Edge Function 偶发不可达时，使用受 RLS 保护的本人资料作为登录检查降级。
    // 这里只读取 auth.uid() 对应的一行，不扩大用户的数据权限。
    const { data: ownProfile, error: profileError } = await client
      .from('profiles')
      .select('role, display_name, must_change_password, is_disabled')
      .eq('id', verifiedUser.user.id)
      .single();
    if (profileError || !ownProfile) throw edgeError;
    if (ownProfile.is_disabled) throw new Error(getUserErrorMessage('account disabled'));
    if (!['admin', 'inv_manager', 'warehouse_keeper', 'staff', 'uploader'].includes(ownProfile.role)) {
      throw new Error(getUserErrorMessage('role not configured'));
    }
    profile = {
      role: ownProfile.role,
      displayName: ownProfile.display_name,
      mustChangePassword: Boolean(ownProfile.must_change_password)
    };
  }
  return {
    id: verifiedUser.user.id,
    username: verifiedUser.user.email,
    label: profile.displayName || verifiedUser.user.email,
    role: profile.role,
    mustChangePassword: profile.mustChangePassword
  };
};

export const updatePassword = async (newPassword) => {
  const client = requireClient();
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw new Error(getUserErrorMessage(error, '修改密码失败，请稍后重试。'));
  // 更新 profile 状态
  await invoke('password_updated');
};

export const listUsers = () => invoke('users_list');
export const createUser = (params) => invoke('user_create', params);
export const toggleUser = (userId, disabled) => invoke('user_toggle', { userId, disabled });
export const resetUserPassword = (userId, newPassword, adminPassword) => invoke('user_reset_password', { userId, newPassword, adminPassword });
export const listAuditLogs = () => invoke('audit_logs');

export const subscribeAuth = (callback) => supabase?.auth.onAuthStateChange((event, session) => callback(session, event))?.data?.subscription;
export const getInventorySummary = async () => invoke('summary');
export const listInventory = async (params = {}) => {
  const { products, total } = await invoke('list', params);
  return { products: products || [], total: total || 0 };
};
export const getInventoryFilterOptions = async () => (await invoke('filter_options')).options || {};
export const listActivity = async () => {
  const rows = (await invoke('activity')).activity || [];
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    type: row.action,
    item: row.product_name,
    qty: row.quantity_label,
    detail: row.detail,
    changes: row.changes,
    actor: row.actor_name,
    time: row.created_at
  }));
};
export const saveInventoryProduct = async (product) => (await invoke('upsert', { product })).product;
export const bulkImportInventory = async (products, fileName = '') => invoke('import_bulk', { products, fileName });
export const deleteInventoryProduct = async (sku) => invoke('delete', { sku });

const MAX_IMAGE_DIMENSION = 1600;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('图片读取失败'));
  reader.readAsDataURL(file);
});

const loadImageElement = (file) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error('图片解析失败，请选择有效的图片文件'));
  };
  image.src = objectUrl;
});

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('图片压缩失败'));
  }, type, quality);
});

const compressImage = async (file) => {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('请选择有效的图片文件');
  }

  const image = await loadImageElement(file);
  const needsResize = image.width > MAX_IMAGE_DIMENSION || image.height > MAX_IMAGE_DIMENSION;
  if (!needsResize && file.size <= MAX_IMAGE_BYTES) return file;

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / image.width, MAX_IMAGE_DIMENSION / image.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持图片压缩');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const outputType = 'image/webp';
  const qualities = [0.84, 0.76, 0.68, 0.58, 0.48];
  let compressedBlob = null;
  for (const quality of qualities) {
    const candidate = await canvasToBlob(canvas, outputType, quality);
    compressedBlob = candidate;
    if (candidate.size <= MAX_IMAGE_BYTES) break;
  }

  if (!compressedBlob) throw new Error('图片压缩失败');
  const compressedName = `${file.name.replace(/\.[^.]+$/, '') || 'product-image'}.webp`;
  return new File([compressedBlob], compressedName, { type: outputType, lastModified: Date.now() });
};

export const getSignedUrl = async (path, options = {}) => (await invoke('get_signed_url', { path, thumbnail: Boolean(options.thumbnail) })).url;
export const getSignedUrls = async (paths, options = {}) => (await invoke('get_signed_urls', { paths, thumbnail: Boolean(options.thumbnail) })).urls || {};

export const uploadProductImage = async (file) => {
  const compressedFile = await compressImage(file);
  const dataUrl = await readFileAsDataUrl(compressedFile);
  const result = await invoke('upload_image', { filename: compressedFile.name, dataUrl });
  return {
    ...result,
    originalSize: file.size,
    uploadedSize: compressedFile.size
  };
};

export const uploadWorkflowDocumentImage = async (file) => {
  const compressedFile = await compressImage(file);
  const dataUrl = await readFileAsDataUrl(compressedFile);
  const result = await invoke('upload_workflow_image', { filename: compressedFile.name, dataUrl });
  return {
    ...result,
    originalSize: file.size,
    uploadedSize: compressedFile.size
  };
};

export const uploadArchiveDocument = async (file, metadata) => {
  const prepared = file.type.startsWith('image/') ? await compressImage(file) : file;
  if (prepared.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超过 8MB`);
  const dataUrl = await readFileAsDataUrl(prepared);
  return invoke('archive_upload', { ...metadata, filename: file.name, dataUrl });
};
export const listArchiveDocuments = async () => (await invoke('archive_list')).documents || [];
export const getArchiveDocumentUrl = async (id, download = false) => invoke('archive_signed_url', { id, download });
export const updateArchiveDocumentStatus = async (id, status) => invoke('archive_status', { id, status });
export const deleteArchiveDocument = async (id) => invoke('archive_delete', { id });
