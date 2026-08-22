import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const BUCKET = 'product-images';
const ALLOWED_ROLES = new Set(['admin', 'inv_manager', 'warehouse_keeper', 'staff', 'uploader']);
// Product master data is a system-level asset. Warehouse keepers and legacy
// inventory managers may review stock, but only the administrator may change it.
const INVENTORY_MANAGER_ROLES = new Set(['admin']);
const USER_ADMIN_ROLES = new Set(['admin']);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function bearerToken(request: Request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function safeText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function safeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusForStock(stock: number) {
  if (stock <= 0) return 'Out of Stock';
  if (stock <= 100) return 'Low Stock';
  if (stock >= 500) return 'High Stock';
  return 'In Stock';
}

function formatValue(field: string, value: unknown) {
  if (field === 'stock') return `${safeNumber(value).toLocaleString()} 件`;
  if (field === 'price' || field === 'cost_price') return `¥${safeNumber(value).toFixed(2)}`;
  if (field === 'width_mm') return value === null || value === undefined || value === '' ? '未填写' : `${safeNumber(value)} mm`;
  if (field === 'image_path') return value ? '已设置图片' : '未设置图片';
  return safeText(value, '未填写');
}

function getChanges(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  if (!before) return '';
  const fields: [string, string][] = [
    ['name', '产品名称'],
    ['image_path', '产品图片'],
    ['category', '分类'],
    ['primary_category', '一级品类'],
    ['secondary_type', '二级类型'],
    ['material', '材质'],
    ['adhesive_type', '背胶'],
    ['width_mm', '宽度(mm)'],
    ['color', '颜色'],
    ['spec', '规格'],
    ['unit', '单位'],
    ['price', '销售价'],
    ['cost_price', '成本价'],
    ['source', '来源']
  ];
  return fields
    .filter(([field]) => String(before[field] ?? '') !== String(after[field] ?? ''))
    .map(([field, label]) => `${label}：${formatValue(field, before[field])} → ${formatValue(field, after[field])}`)
    .join('；') || '未检测到字段变化';
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!match) throw new Error('仅支持 PNG/JPEG/WEBP/GIF 图片');
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('图片压缩后仍超过 2MB，请选择更小的图片');
  return { mime, bytes };
}

function decodeArchiveDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp)|application\/pdf);base64,(.+)$/i);
  if (!match) throw new Error('仅支持 PNG、JPEG、WEBP 或 PDF 文件');
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('文件不能超过 8MB');
  return { mime, bytes };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration is incomplete' }, 500);
  }

  const token = bearerToken(request);
  if (!token) return jsonResponse({ error: 'Authentication required' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return jsonResponse({ error: 'Invalid authentication token' }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role, display_name, must_change_password, is_disabled')
    .eq('id', authData.user.id)
    .single();
  if (profileError || !profile || !ALLOWED_ROLES.has(profile.role)) {
    return jsonResponse({ error: 'Profile or role is not configured' }, 403);
  }
  if (profile.is_disabled) return jsonResponse({ error: '您的账号已被禁用，请联系管理员。' }, 403);

  const payload = await readJson(request);
  if (!payload || typeof payload.action !== 'string') return jsonResponse({ error: 'Invalid JSON payload' }, 400);

  const action = payload.action;
  const uid = authData.user.id;
  const actorName = profile.display_name || authData.user.email || '';
  const isSystemAdmin = USER_ADMIN_ROLES.has(profile.role);
  const canManageInventory = INVENTORY_MANAGER_ROLES.has(profile.role);
  const canReviewWorkflowImages = ['admin', 'warehouse_keeper', 'inv_manager'].includes(profile.role);

  const uploaderActions = new Set(['profile', 'password_updated', 'archive_upload', 'archive_list', 'archive_signed_url', 'archive_delete']);
  if (profile.role === 'uploader' && !uploaderActions.has(action)) {
    return jsonResponse({ error: '快速上传账号只能使用拍照上传功能' }, 403);
  }

  const logAudit = async (actionType: string, resourceType: string, resourceId: string, detail: string) => {
    const { error } = await adminClient.from('system_audit_log').insert({
      actor_id: uid,
      actor_name: actorName,
      action_type: actionType,
      resource_type: resourceType,
      resource_id: resourceId,
      detail
    });
    // 审计日志不可反向阻断主营业务；部署库若尚未建表，由后续 migration 补齐。
    if (error) console.error('[audit-log]', error.message);
  };

  if (action === 'profile') {
    return jsonResponse({
      role: profile.role,
      displayName: actorName,
      mustChangePassword: Boolean(profile.must_change_password)
    });
  }

  if (action === 'password_updated') {
    const { error } = await adminClient.from('profiles').update({ must_change_password: false }).eq('id', uid);
    if (error) return jsonResponse({ error: '改密状态更新失败: ' + error.message }, 500);
    await logAudit('change_password', 'user', uid, '用户完成了首次登录改密');
    return jsonResponse({ ok: true });
  }

  if (action === 'summary') {
    const { data: stats, error } = await adminClient.rpc('get_inventory_summary_v2');
    if (error) return jsonResponse({ error: '汇总失败: ' + error.message }, 500);
    const { data: distribution, error: distError } = await adminClient.rpc('get_category_distribution');
    if (distError) return jsonResponse({ error: '分类汇总失败: ' + distError.message }, 500);
    return jsonResponse({ metrics: stats, distribution: distribution || [] });
  }

  if (action === 'list') {
    const page = Math.max(1, safeNumber(payload.page, 1));
    const pageSize = Math.max(1, Math.min(100, safeNumber(payload.pageSize, 20)));
    const search = safeText(payload.search);
    const category = safeText(payload.category);
    const status = safeText(payload.status);
    const primaryCategory = safeText(payload.primary_category);
    const secondaryType = safeText(payload.secondary_type);
    const material = safeText(payload.material);
    const adhesiveType = safeText(payload.adhesive_type);
    const widthMm = safeText(payload.width_mm);
    const color = safeText(payload.color);

    let selectFields = 'sku, name, image_path, category, primary_category, secondary_type, material, adhesive_type, width_mm, color, spec, stock, available_stock, locked_stock, inspect_stock, transit_stock, defective_stock, retail_stock, unit, price, source, status, created_at, updated_at';
    if (canManageInventory) selectFields += ', cost_price';

    let query = adminClient.from('inventory_products').select(selectFields, { count: 'exact' });
    if (search) query = query.or(`sku.ilike.%${search}%,name.ilike.%${search}%,spec.ilike.%${search}%,primary_category.ilike.%${search}%,secondary_type.ilike.%${search}%,material.ilike.%${search}%,adhesive_type.ilike.%${search}%,color.ilike.%${search}%`);
    if (category && category !== 'All') query = query.eq('category', category);
    if (status && status !== 'All') query = query.eq('status', status);
    if (primaryCategory && primaryCategory !== 'All') query = query.eq('primary_category', primaryCategory);
    if (secondaryType && secondaryType !== 'All') query = query.eq('secondary_type', secondaryType);
    if (material && material !== 'All') query = query.eq('material', material);
    if (adhesiveType && adhesiveType !== 'All') query = query.eq('adhesive_type', adhesiveType);
    if (widthMm && widthMm !== 'All') query = query.eq('width_mm', safeNumber(widthMm));
    if (color && color !== 'All') query = query.eq('color', color);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) return jsonResponse({ error: '加载库存失败: ' + error.message }, 500);

    const products = await Promise.all((data || []).map(async (product) => {
      let imageUrl = '';
      if (product.image_path) {
        const signed = await adminClient.storage.from(BUCKET).createSignedUrl(product.image_path, 3600);
        imageUrl = signed.data?.signedUrl || '';
      }
      return { ...product, id: product.sku, image: imageUrl };
    }));
    return jsonResponse({ products, total: count || 0, page, pageSize });
  }

  if (action === 'filter_options') {
    const { data, error } = await adminClient
      .from('inventory_products')
      .select('category, primary_category, secondary_type, material, adhesive_type, width_mm, color')
      .order('primary_category', { ascending: true });
    if (error) return jsonResponse({ error: '加载筛选项失败: ' + error.message }, 500);
    const uniqueText = (field: string) => [...new Set((data || []).map((row: Record<string, unknown>) => safeText(row[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const widths = [...new Set((data || []).map((row: Record<string, unknown>) => safeNumber(row.width_mm, Number.NaN)).filter(Number.isFinite))].sort((a, b) => a - b);
    return jsonResponse({
      options: {
        categories: uniqueText('category'),
        primary_categories: uniqueText('primary_category'),
        secondary_types: uniqueText('secondary_type'),
        materials: uniqueText('material'),
        adhesive_types: uniqueText('adhesive_type'),
        widths,
        colors: uniqueText('color')
      }
    });
  }

  if (action === 'activity') {
    const limit = Math.max(20, Math.min(200, safeNumber(payload.limit, 100)));
    const { data: activity, error } = await adminClient
      .from('inventory_activity')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return jsonResponse({ error: error.message }, 500);
    let batches: unknown[] = [];
    if (canManageInventory) {
      const result = await adminClient.from('import_batches').select('*').order('created_at', { ascending: false }).limit(10);
      batches = result.data || [];
    }
    return jsonResponse({ activity: activity || [], batches });
  }

  if (action === 'upsert') {
    if (!canManageInventory) return jsonResponse({ error: '无权限修改产品资料' }, 403);
    const product = (payload.product || {}) as Record<string, unknown>;
    const sku = safeText(product.sku || product.id);
    const originalSku = safeText(product.original_sku || sku);
    if (!sku) return jsonResponse({ error: 'SKU 不能为空' }, 400);

    const { data: before, error: beforeError } = await adminClient.from('inventory_products').select('*').eq('sku', originalSku).maybeSingle();
    if (beforeError) return jsonResponse({ error: '读取原产品失败: ' + beforeError.message }, 500);

    if (before && originalSku !== sku) {
      const { error: renameError } = await adminClient.rpc('rename_inventory_sku', {
        p_old_sku: originalSku,
        p_new_sku: sku
      });
      if (renameError) return jsonResponse({ error: 'SKU 修改失败: ' + renameError.message }, 400);
    }

    const metadataRow: Record<string, unknown> = {
      sku,
      name: safeText(product.name),
      image_path: safeText(product.image_path),
      category: safeText(product.primary_category) || safeText(product.category) || '未分类',
      primary_category: safeText(product.primary_category) || safeText(product.category) || '未分类',
      secondary_type: safeText(product.secondary_type),
      material: safeText(product.material),
      adhesive_type: safeText(product.adhesive_type),
      width_mm: product.width_mm === '' || product.width_mm == null ? null : Math.max(0, safeNumber(product.width_mm)),
      color: safeText(product.color),
      spec: safeText(product.spec),
      unit: safeText(product.unit, '条'),
      price: Math.max(0, safeNumber(product.price)),
      cost_price: Math.max(0, safeNumber(product.cost_price)),
      source: safeText(product.source),
      updated_by: uid,
      updated_at: new Date().toISOString()
    };

    if (!before) {
      const initialStock = Math.max(0, safeNumber(product.stock));
      Object.assign(metadataRow, {
        stock: initialStock,
        available_stock: initialStock,
        locked_stock: 0,
        inspect_stock: 0,
        transit_stock: 0,
        defective_stock: 0,
        retail_stock: 0,
        status: statusForStock(initialStock),
        created_by: uid
      });
    } else {
      // 已存在 SKU 的数量只能通过入/出库、盘点、调拨等单据流水改变，资料编辑不能覆盖库存。
      Object.assign(metadataRow, { status: statusForStock(safeNumber(before.stock)) });
    }

    const { data: saved, error } = await adminClient
      .from('inventory_products')
      .upsert(metadataRow, { onConflict: 'sku' })
      .select('*')
      .single();
    if (error) return jsonResponse({ error: '保存失败: ' + error.message }, 500);

    await logAudit(before ? 'edit_product' : 'create_product', 'inventory', sku, before ? `修改产品 ${originalSku}${originalSku !== sku ? ` → ${sku}` : ''} 的主数据（未覆盖库存数量）` : `创建产品 ${sku}`);
    await adminClient.from('inventory_activity').insert({
      sku,
      product_name: safeText(saved.name),
      action: before ? 'EDIT' : 'IN',
      quantity_label: before ? '资料修改' : `初始 +${safeNumber(saved.stock).toLocaleString()}`,
      detail: before ? `修改产品 ${sku} 主数据；库存数量保持不变` : `新增产品 ${sku}`,
      changes: getChanges(before, saved),
      actor_id: uid,
      actor_name: actorName
    });
    return jsonResponse({ product: saved, stockPreserved: Boolean(before) });
  }

  if (action === 'import_bulk') {
    if (!canManageInventory) return jsonResponse({ error: '无权限导入产品资料' }, 403);
    const products = Array.isArray(payload.products) ? payload.products as Record<string, unknown>[] : [];
    const fileName = safeText(payload.fileName, '未命名文件');
    if (products.length === 0) return jsonResponse({ error: '导入数据不能为空' }, 400);
    if (products.length > 5000) return jsonResponse({ error: '单次最多导入 5000 行，请拆分文件' }, 400);

    const batchNo = `IMP-${Date.now()}`;
    const successRows: string[] = [];
    const failedRows: Record<string, unknown>[] = [];
    let preservedStockRows = 0;

    for (const p of products) {
      const sku = safeText(p.sku || p.id);
      if (!sku) {
        failedRows.push({ sku: '', name: safeText(p.name), error: 'SKU 不能为空', excelRow: p.excelRow });
        continue;
      }
      const { data: existing, error: existingError } = await adminClient.from('inventory_products').select('sku, stock').eq('sku', sku).maybeSingle();
      if (existingError) {
        failedRows.push({ sku, name: safeText(p.name), error: existingError.message, excelRow: p.excelRow });
        continue;
      }

      const row: Record<string, unknown> = {
        sku,
        name: safeText(p.name),
        category: safeText(p.primary_category) || safeText(p.category) || '未分类',
        primary_category: safeText(p.primary_category) || safeText(p.category) || '未分类',
        secondary_type: safeText(p.secondary_type),
        material: safeText(p.material),
        adhesive_type: safeText(p.adhesive_type),
        width_mm: p.width_mm === '' || p.width_mm == null ? null : Math.max(0, safeNumber(p.width_mm)),
        color: safeText(p.color),
        spec: safeText(p.spec),
        unit: safeText(p.unit, '条'),
        price: Math.max(0, safeNumber(p.price)),
        source: safeText(p.source),
        updated_by: uid,
        updated_at: new Date().toISOString()
      };

      if (!existing) {
        const initialStock = Math.max(0, safeNumber(p.stock));
        Object.assign(row, {
          stock: initialStock,
          available_stock: initialStock,
          locked_stock: 0,
          inspect_stock: 0,
          transit_stock: 0,
          defective_stock: 0,
          retail_stock: 0,
          status: statusForStock(initialStock),
          created_by: uid
        });
      } else {
        preservedStockRows += 1;
        Object.assign(row, { status: statusForStock(safeNumber(existing.stock)) });
      }

      const { error } = await adminClient.from('inventory_products').upsert(row, { onConflict: 'sku' });
      if (error) failedRows.push({ sku, name: safeText(p.name), error: error.message, excelRow: p.excelRow });
      else successRows.push(sku);
    }

    const { error: batchError } = await adminClient.from('import_batches').insert({
      batch_no: batchNo,
      file_name: fileName,
      imported_by: uid,
      total_rows: products.length,
      success_rows: successRows.length,
      failed_rows: failedRows.length,
      error_log: failedRows
    });
    if (batchError) console.error('[import-batch]', batchError.message);

    await logAudit('import_inventory', 'inventory', batchNo, `批量导入产品资料: 成功 ${successRows.length} 条, 失败 ${failedRows.length} 条；已有 SKU ${preservedStockRows} 条未覆盖库存`);
    return jsonResponse({
      importedCount: successRows.length,
      failedCount: failedRows.length,
      preservedStockRows,
      batchNo,
      errors: failedRows
    });
  }

  if (action === 'delete') {
    if (!canManageInventory) return jsonResponse({ error: '无权限删除产品' }, 403);
    const sku = safeText(payload.sku);
    const { data: before, error: readError } = await adminClient.from('inventory_products').select('*').eq('sku', sku).single();
    if (readError || !before) return jsonResponse({ error: '产品不存在' }, 404);

    const quantityFields = ['stock', 'available_stock', 'locked_stock', 'inspect_stock', 'transit_stock', 'defective_stock', 'retail_stock'];
    if (quantityFields.some((field) => Math.abs(safeNumber(before[field])) > 0.000001)) {
      return jsonResponse({ error: '该产品仍有库存或库存状态余额，禁止直接删除；请先通过盘点/出库单清零。' }, 409);
    }

    const { count: movementCount } = await adminClient.from('inventory_movements').select('*', { count: 'exact', head: true }).eq('sku', sku);
    if ((movementCount || 0) > 0) {
      return jsonResponse({ error: '该产品已有库存流水，禁止物理删除。建议停用或保留主数据以确保可追溯。' }, 409);
    }

    const { error } = await adminClient.from('inventory_products').delete().eq('sku', sku);
    if (error) return jsonResponse({ error: '删除失败: ' + error.message }, 500);
    await logAudit('delete_product', 'inventory', sku, `删除零库存且无流水的产品 ${sku}`);
    await adminClient.from('inventory_activity').insert({
      sku,
      product_name: before.name,
      action: 'OUT',
      quantity_label: '已删除',
      detail: `删除产品 ${sku}`,
      actor_id: uid,
      actor_name: actorName
    });
    return jsonResponse({ ok: true });
  }

  if (action === 'users_list') {
    if (!isSystemAdmin) return jsonResponse({ error: '只有系统管理员可以查看用户列表' }, 403);
    const [{ data: users, error }, { data: authUsers, error: authUsersError }] = await Promise.all([
      adminClient.from('profiles').select('*').order('created_at', { ascending: false }),
      adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
    ]);
    if (error) return jsonResponse({ error: error.message }, 500);
    if (authUsersError) return jsonResponse({ error: '登录账号读取失败: ' + authUsersError.message }, 500);
    const authById = new Map((authUsers?.users || []).map((user) => [user.id, user]));
    return jsonResponse({ users: (users || []).map((user) => {
      const authUser = authById.get(user.id);
      const email = safeText(authUser?.email).toLowerCase();
      return {
        ...user,
        email,
        username: email ? email.split('@')[0] : '',
        last_sign_in_at: authUser?.last_sign_in_at || null
      };
    }) });
  }

  if (action === 'user_create') {
    if (!isSystemAdmin) return jsonResponse({ error: '只有系统管理员可以创建用户' }, 403);
    const email = safeText(payload.email).toLowerCase();
    const password = safeText(payload.password);
    const role = safeText(payload.role, 'staff');
    const displayName = safeText(payload.displayName);

    if (!email || !password || !displayName) return jsonResponse({ error: '邮箱、初始密码和姓名不能为空' }, 400);
    if (password.length < 8) return jsonResponse({ error: '初始密码至少需要 8 位' }, 400);
    if (!ALLOWED_ROLES.has(role)) return jsonResponse({ error: '无效角色' }, 400);

    const { data: authUser, error: authCreateError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, role_flag: role }
    });
    if (authCreateError || !authUser.user) return jsonResponse({ error: 'Auth 创建失败: ' + (authCreateError?.message || 'unknown') }, 500);

    const { error: profileUpdateError } = await adminClient.from('profiles').upsert({
      id: authUser.user.id,
      display_name: displayName,
      role,
      must_change_password: true,
      is_disabled: false,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (profileUpdateError) {
      await adminClient.auth.admin.deleteUser(authUser.user.id);
      return jsonResponse({ error: 'Profile 更新失败，已回滚新账号: ' + profileUpdateError.message }, 500);
    }

    await logAudit('create_user', 'user', authUser.user.id, `创建新用户: ${email} (${role})`);
    return jsonResponse({ ok: true, userId: authUser.user.id });
  }

  if (action === 'user_toggle') {
    if (!isSystemAdmin) return jsonResponse({ error: '只有系统管理员可以启停用户' }, 403);
    const targetId = safeText(payload.userId);
    const disabled = Boolean(payload.disabled);
    if (!targetId) return jsonResponse({ error: '用户 ID 不能为空' }, 400);
    if (targetId === uid && disabled) return jsonResponse({ error: '不能停用当前登录的管理员账号' }, 400);

    const { error } = await adminClient.auth.admin.updateUserById(targetId, { ban_duration: disabled ? '87600h' : 'none' });
    if (error) return jsonResponse({ error: '操作失败: ' + error.message }, 500);
    const { error: profileToggleError } = await adminClient.from('profiles').update({ is_disabled: disabled }).eq('id', targetId);
    if (profileToggleError) return jsonResponse({ error: '账号状态同步失败: ' + profileToggleError.message }, 500);

    await logAudit(disabled ? 'disable_user' : 'enable_user', 'user', targetId, `${disabled ? '禁用' : '启用'}用户账号`);
    return jsonResponse({ ok: true });
  }

  if (action === 'user_reset_password') {
    if (!isSystemAdmin) return jsonResponse({ error: '只有系统管理员可以重设用户密码' }, 403);
    const targetId = safeText(payload.userId);
    const newPassword = safeText(payload.newPassword);
    const adminPassword = safeText(payload.adminPassword);
    if (!targetId || !newPassword || !adminPassword) return jsonResponse({ error: '用户、临时密码和管理员密码不能为空' }, 400);
    if (newPassword.length < 8) return jsonResponse({ error: '新临时密码至少需要 8 位' }, 400);
    if (!authData.user.email) return jsonResponse({ error: '当前管理员账号未绑定邮箱，无法验证身份' }, 400);

    const verificationClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: verification, error: verificationError } = await verificationClient.auth.signInWithPassword({
      email: authData.user.email,
      password: adminPassword
    });
    if (verificationError || verification.user?.id !== uid) {
      return jsonResponse({ error: '管理员密码验证失败，请重新输入当前管理员密码' }, 403);
    }
    await verificationClient.auth.signOut();

    const { data: targetUser, error: targetLookupError } = await adminClient.auth.admin.getUserById(targetId);
    if (targetLookupError || !targetUser.user) return jsonResponse({ error: '目标用户不存在' }, 404);
    const { error: passwordError } = await adminClient.auth.admin.updateUserById(targetId, { password: newPassword });
    if (passwordError) return jsonResponse({ error: '重设密码失败: ' + passwordError.message }, 500);
    const { error: profileUpdateError } = await adminClient.from('profiles').update({
      must_change_password: true,
      updated_at: new Date().toISOString()
    }).eq('id', targetId);
    if (profileUpdateError) return jsonResponse({ error: '密码已重设，但首次改密状态同步失败: ' + profileUpdateError.message }, 500);

    await logAudit('reset_user_password', 'user', targetId, `管理员重设用户临时密码: ${targetUser.user.email || targetId}`);
    return jsonResponse({ ok: true });
  }

  if (action === 'upload_image') {
    if (!canManageInventory) return jsonResponse({ error: '无权限上传产品图片' }, 403);
    const dataUrl = safeText(payload.dataUrl);
    const originalName = safeText(payload.filename, 'product-image.webp').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!dataUrl) return jsonResponse({ error: '图片内容不能为空' }, 400);
    let decoded;
    try {
      decoded = decodeDataUrl(dataUrl);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : '图片解析失败' }, 400);
    }
    const ext = decoded.mime === 'image/jpeg' ? 'jpg' : decoded.mime.split('/')[1];
    const baseName = originalName.replace(/\.[^.]+$/, '') || 'product-image';
    const path = `products/${uid}/${Date.now()}-${baseName}.${ext}`;
    const { error } = await adminClient.storage.from(BUCKET).upload(path, decoded.bytes, {
      contentType: decoded.mime,
      cacheControl: '3600',
      upsert: false
    });
    if (error) return jsonResponse({ error: '图片上传失败: ' + error.message }, 500);
    const { data: signed } = await adminClient.storage.from(BUCKET).createSignedUrl(path, 3600);
    await logAudit('upload_product_image', 'storage', path, '上传产品图片');
    return jsonResponse({ path, url: signed?.signedUrl || '' });
  }

  if (action === 'upload_workflow_image') {
    const dataUrl = safeText(payload.dataUrl);
    const originalName = safeText(payload.filename, 'workflow-document.webp').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!dataUrl) return jsonResponse({ error: '图片内容不能为空' }, 400);
    let decoded;
    try {
      decoded = decodeDataUrl(dataUrl);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : '图片解析失败' }, 400);
    }
    const ext = decoded.mime === 'image/jpeg' ? 'jpg' : decoded.mime.split('/')[1];
    const baseName = originalName.replace(/\.[^.]+$/, '') || 'workflow-document';
    const path = `workflow-docs/${uid}/${Date.now()}-${baseName}.${ext}`;
    const { error } = await adminClient.storage.from(BUCKET).upload(path, decoded.bytes, {
      contentType: decoded.mime,
      cacheControl: '3600',
      upsert: false
    });
    if (error) return jsonResponse({ error: '单据图片上传失败: ' + error.message }, 500);
    const { data: signed } = await adminClient.storage.from(BUCKET).createSignedUrl(path, 3600);
    await logAudit('upload_workflow_image', 'storage', path, '上传业务单据凭证');
    return jsonResponse({ path, url: signed?.signedUrl || '' });
  }

  if (action === 'archive_upload') {
    const kind = safeText(payload.document_kind);
    const documentDate = safeText(payload.document_date);
    const partnerName = safeText(payload.partner_name).slice(0, 200);
    const notes = safeText(payload.notes).slice(0, 1000);
    const dataUrl = safeText(payload.dataUrl);
    const rawName = safeText(payload.filename, 'document').slice(0, 180);
    if (!['delivery_note', 'receipt_note', 'outbound_note'].includes(kind)) return jsonResponse({ error: '请选择正确的单据类型' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate)) return jsonResponse({ error: '请选择正确的单据日期' }, 400);
    let decoded;
    try { decoded = decodeArchiveDataUrl(dataUrl); } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : '文件解析失败' }, 400);
    }
    const extension = decoded.mime === 'application/pdf' ? 'pdf' : decoded.mime === 'image/jpeg' ? 'jpg' : decoded.mime.split('/')[1];
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '') || 'document';
    const path = `shared-documents/${uid}/${documentDate}/${crypto.randomUUID()}-${safeName}.${extension}`;
    const { error: uploadError } = await adminClient.storage.from(BUCKET).upload(path, decoded.bytes, {
      contentType: decoded.mime, cacheControl: '3600', upsert: false
    });
    if (uploadError) return jsonResponse({ error: '文件上传失败: ' + uploadError.message }, 500);
    const { data: record, error: insertError } = await adminClient.from('shared_document_archive').insert({
      document_kind: kind, document_date: documentDate, partner_name: partnerName, notes,
      original_file_name: rawName, storage_path: path, mime_type: decoded.mime,
      file_size: decoded.bytes.byteLength, uploaded_by: uid, uploaded_by_name: actorName
    }).select('*').single();
    if (insertError) {
      await adminClient.storage.from(BUCKET).remove([path]);
      return jsonResponse({ error: '资料建档失败: ' + insertError.message }, 500);
    }
    await logAudit('archive_upload', 'shared_document', record.id, `上传${kind === 'delivery_note' ? '送货单' : '收货单'}：${rawName}`);
    return jsonResponse({ document: record });
  }

  if (action === 'archive_list') {
    let query = adminClient.from('shared_document_archive').select('*').order('document_date', { ascending: false }).order('uploaded_at', { ascending: false }).limit(500);
    if (['staff', 'uploader'].includes(profile.role)) query = query.eq('uploaded_by', uid);
    const { data, error } = await query;
    if (error) return jsonResponse({ error: '资料加载失败: ' + error.message }, 500);
    return jsonResponse({ documents: data || [] });
  }

  if (action === 'archive_signed_url') {
    const id = safeText(payload.id);
    const download = Boolean(payload.download);
    const { data: record, error: recordError } = await adminClient.from('shared_document_archive').select('*').eq('id', id).maybeSingle();
    if (recordError || !record) return jsonResponse({ error: '资料不存在' }, 404);
    if (['staff', 'uploader'].includes(profile.role) && record.uploaded_by !== uid) return jsonResponse({ error: '无权查看该资料' }, 403);
    const options = download ? { download: record.original_file_name } : undefined;
    const { data, error } = await adminClient.storage.from(BUCKET).createSignedUrl(record.storage_path, 600, options);
    if (error) return jsonResponse({ error: '下载地址生成失败: ' + error.message }, 500);
    if (download) await adminClient.from('shared_document_archive').update({
      download_count: Number(record.download_count || 0) + 1, last_downloaded_at: new Date().toISOString(), last_downloaded_by: uid
    }).eq('id', id);
    return jsonResponse({ url: data.signedUrl, filename: record.original_file_name });
  }

  if (action === 'archive_status') {
    if (!isSystemAdmin) return jsonResponse({ error: '只有管理员可以更新资料状态' }, 403);
    const id = safeText(payload.id);
    const status = safeText(payload.status);
    if (!['reviewed', 'archived'].includes(status)) return jsonResponse({ error: '状态不正确' }, 400);
    const { error } = await adminClient.from('shared_document_archive').update({
      status, reviewed_by: uid, reviewed_at: new Date().toISOString()
    }).eq('id', id);
    if (error) return jsonResponse({ error: '状态更新失败: ' + error.message }, 500);
    await logAudit('archive_status', 'shared_document', id, status === 'reviewed' ? '标记资料已查看' : '归档资料');
    return jsonResponse({ ok: true });
  }

  if (action === 'archive_delete') {
    const id = safeText(payload.id);
    const { data: record } = await adminClient.from('shared_document_archive').select('*').eq('id', id).maybeSingle();
    if (!record) return jsonResponse({ error: '资料不存在' }, 404);
    if (!isSystemAdmin && (record.uploaded_by !== uid || record.status !== 'uploaded')) return jsonResponse({ error: '只能删除自己尚未处理的资料' }, 403);
    const { error } = await adminClient.from('shared_document_archive').delete().eq('id', id);
    if (error) return jsonResponse({ error: '删除失败: ' + error.message }, 500);
    await adminClient.storage.from(BUCKET).remove([record.storage_path]);
    await logAudit('archive_delete', 'shared_document', id, `删除资料：${record.original_file_name}`);
    return jsonResponse({ ok: true });
  }

  if (action === 'get_signed_url') {
    const path = safeText(payload.path);
    const thumbnail = Boolean(payload.thumbnail);
    if (!path) return jsonResponse({ error: '路径不能为空' }, 400);

    // 产品主图属于共享主数据；业务单据凭证必须根据绑定单据和角色授权。
    if (path.startsWith('workflow-docs/')) {
      const { data: documents, error: documentError } = await adminClient
        .from('inventory_documents')
        .select('created_by')
        .eq('image_path', path)
        .limit(200);
      if (documentError) return jsonResponse({ error: '附件权限校验失败: ' + documentError.message }, 500);

      const ownsUnboundUpload = path.startsWith(`workflow-docs/${uid}/`);
      const hasBoundDocument = Boolean(documents?.length);
      const canViewBoundDocument = hasBoundDocument && (canReviewWorkflowImages || documents.some((document) => document.created_by === uid));
      if ((!hasBoundDocument && !ownsUnboundUpload) || (hasBoundDocument && !canViewBoundDocument)) {
        return jsonResponse({ error: '无权查看该业务单据凭证' }, 403);
      }
    } else if (!path.startsWith('products/')) {
      // source-docs 下尚未形成业务单据的原始 OCR 文件仍按上传人隔离。
      const { data: sourceDoc, error: sourceDocError } = await adminClient
        .from('v2_source_documents')
        .select('uploader_id')
        .eq('file_url', path)
        .maybeSingle();
      if (sourceDocError) return jsonResponse({ error: '附件权限校验失败: ' + sourceDocError.message }, 500);
      if (!sourceDoc || (!canManageInventory && sourceDoc.uploader_id !== uid)) {
        return jsonResponse({ error: '无权查看该原始凭证' }, 403);
      }
    }

    const { data, error } = await adminClient.storage.from(BUCKET).createSignedUrl(
      path,
      3600,
      thumbnail ? { transform: { width: 240, height: 240, resize: 'cover', quality: 55 } } : undefined
    );
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ url: data.signedUrl });
  }

  if (action === 'get_signed_urls') {
    const paths = Array.from(new Set(
      (Array.isArray(payload.paths) ? payload.paths : [])
        .map((value) => safeText(value))
        .filter(Boolean)
    )).slice(0, 200);
    const thumbnail = Boolean(payload.thumbnail);
    if (!paths.length) return jsonResponse({ urls: {} });

    // 批量入口只开放产品主图与业务单据凭证；业务凭证一次查询后逐项鉴权。
    const denied = paths.find((path) => !path.startsWith('products/') && !path.startsWith('workflow-docs/'));
    if (denied) return jsonResponse({ error: '批量图片请求包含无权访问的路径' }, 403);

    const workflowPaths = paths.filter((path) => path.startsWith('workflow-docs/'));
    const documentsByPath = new Map<string, Set<string>>();
    if (workflowPaths.length) {
      const { data: documents, error: documentsError } = await adminClient
        .from('inventory_documents')
        .select('image_path, created_by')
        .in('image_path', workflowPaths);
      if (documentsError) return jsonResponse({ error: '附件权限校验失败: ' + documentsError.message }, 500);
      for (const document of documents || []) {
        const imagePath = safeText(document.image_path);
        if (!imagePath) continue;
        const owners = documentsByPath.get(imagePath) || new Set<string>();
        owners.add(safeText(document.created_by));
        documentsByPath.set(imagePath, owners);
      }
    }

    const unauthorizedWorkflowPath = workflowPaths.find((path) => {
      const owners = documentsByPath.get(path);
      if (!owners) return !path.startsWith(`workflow-docs/${uid}/`);
      return !canReviewWorkflowImages && !owners.has(uid);
    });
    if (unauthorizedWorkflowPath) return jsonResponse({ error: '批量图片请求包含无权访问的业务单据凭证' }, 403);

    const pairs = await Promise.all(paths.map(async (path) => {
      const { data, error } = await adminClient.storage.from(BUCKET).createSignedUrl(
        path,
        3600,
        thumbnail ? { transform: { width: 240, height: 240, resize: 'cover', quality: 55 } } : undefined
      );
      return [path, error ? '' : (data?.signedUrl || '')];
    }));
    return jsonResponse({ urls: Object.fromEntries(pairs) });
  }

  if (action === 'audit_logs') {
    if (!isSystemAdmin) return jsonResponse({ error: '只有系统管理员可以查看审计日志' }, 403);
    const { data, error } = await adminClient.from('system_audit_log').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ logs: data || [] });
  }

  return jsonResponse({ error: `Unsupported action: ${action}` }, 400);
});
