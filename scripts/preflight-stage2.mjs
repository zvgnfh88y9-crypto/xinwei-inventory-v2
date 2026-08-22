import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const passes = [];

const pass = (name) => passes.push(name);
const fail = (name, detail = '') => failures.push(`${name}${detail ? `：${detail}` : ''}`);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // 本地依赖和构建产物不属于源码交付扫描范围，也避免预检遍历数万文件。
    if (entry.isDirectory() && ['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replaceAll('\\', '/');
    if (entry.isDirectory()) walk(full, out);
    else out.push(rel);
  }
  return out;
};

const files = walk(root);
const forbiddenBasenames = new Set(['token.txt']);
const forbidden = files.filter((file) => forbiddenBasenames.has(path.basename(file)));
const gitignore = fs.existsSync(path.join(root, '.gitignore')) ? read('.gitignore').split(/\r?\n/) : [];
if (fs.existsSync(path.join(root, '.env.local')) && !gitignore.includes('.env.local')) {
  forbidden.push('.env.local（未加入 .gitignore）');
}
if (forbidden.length) fail('敏感/平台依赖文件检查', forbidden.join(', '));
else pass('源码目录未发现敏感配置文件');

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const rootLockDependencies = packageLock.packages?.['']?.dependencies || {};
const lockMismatch = Object.entries(packageJson.dependencies || {})
  .filter(([name, version]) => rootLockDependencies[name] !== version);
if (lockMismatch.length) fail('package.json 与锁文件依赖声明一致', lockMismatch.map(([name]) => name).join(', '));
else pass('package.json 与锁文件依赖声明一致');

const wms = read('supabase/functions/wms-v2-action/index.ts');
const inventory = read('supabase/functions/inventory-action/index.ts');
for (const action of ['run_migration', 'reset_system_passwords']) {
  const executablePattern = new RegExp(`action\\s*===\\s*['\"]${action}['\"]`);
  if (executablePattern.test(wms) || executablePattern.test(inventory)) fail(`危险动作 ${action} 仍可执行`);
  else pass(`危险动作 ${action} 不存在可执行分支`);
}

const requiredMigrations = [
  'supabase/migrations/0014_stage1_security_roles_inventory.sql',
  'supabase/migrations/0015_wms_v2_schema_and_inventory_bridge.sql',
  'supabase/migrations/0016_sales_production_qc_shipping_loop.sql'
  ,'supabase/migrations/20260812090000_safe_product_sku_rename.sql'
  ,'supabase/migrations/20260812093000_fix_sku_rename_legacy_schema.sql'
  ,'supabase/migrations/20260812103000_enforce_document_approval_flow.sql'
  ,'supabase/migrations/20260813120000_persistent_workflow_notifications.sql'
  ,'supabase/migrations/20260813150000_product_structured_fields.sql'
  ,'supabase/migrations/20260813170000_harden_workflow_and_void.sql'
  ,'supabase/migrations/20260813180000_atomic_workflow_draft_update.sql'
];
for (const file of requiredMigrations) {
  if (fs.existsSync(path.join(root, file))) pass(`迁移存在 ${path.basename(file)}`);
  else fail(`缺少迁移 ${file}`);
}

const stage2 = read('supabase/migrations/0016_sales_production_qc_shipping_loop.sql');
for (const fn of [
  'v2_refresh_sales_order_status',
  'v2_lock_inventory',
  'v2_complete_production',
  'v2_finalize_inspection',
  'v2_ship_sales_order',
  'v2_confirm_shipment_delivery'
]) {
  if (stage2.includes(`function public.${fn}`)) pass(`Stage 2 RPC 已定义 ${fn}`);
  else fail(`Stage 2 RPC 缺失 ${fn}`);
}

for (const action of [
  'lock_inventory',
  'create_production_order',
  'issue_materials',
  'complete_production',
  'create_inspection',
  'ship_sales_order',
  'confirm_shipment_delivery'
]) {
  if (wms.includes(`action === '${action}'`)) pass(`WMS Edge action 已实现 ${action}`);
  else fail(`WMS Edge action 缺失 ${action}`);
}

const api = read('src/lib/wmsV2Api.js');
for (const apiName of ['lockInventoryForPlan', 'shipSalesOrder', 'confirmShipmentDelivery']) {
  if (api.includes(`export const ${apiName}`)) pass(`前端 API 已导出 ${apiName}`);
  else fail(`前端 API 缺失 ${apiName}`);
}

const salesPage = read('src/pages/SalesOrderPage.jsx');
const productionPage = read('src/pages/ProductionPage.jsx');
const inventoryTable = read('src/components/inventory/InventoryTable.jsx');
if (salesPage.includes('待排产缺口') && salesPage.includes('出库已锁定')) pass('销售订单页面包含锁库/缺口/出货闭环入口');
else fail('销售订单闭环入口不完整');
if (productionPage.includes('关联销售订单缺口') && productionPage.includes('质检合格后系统会自动')) pass('生产页面包含订单关联排产提示');
else fail('生产订单关联逻辑 UI 不完整');
if (inventoryTable.includes('product-image-input') && inventoryTable.includes('uploadProductImage(file)') && inventoryTable.includes('image: url')) pass('产品新增/编辑弹窗支持图片上传与预览');
else fail('产品图片上传入口或上传结果绑定不完整');
const skuRenameMigration = read('supabase/migrations/20260812090000_safe_product_sku_rename.sql');
if (inventoryTable.includes('original_sku') && inventoryTable.includes('primary-category-options') && inventoryTable.includes('secondary_type') && skuRenameMigration.includes('rename_inventory_sku')) pass('产品编辑支持结构化分类修改与安全 SKU 级联重命名');
else fail('产品分类修改或 SKU 安全重命名链路不完整');
const structuredProductMigration = read('supabase/migrations/20260813150000_product_structured_fields.sql');
if (['primary_category', 'secondary_type', 'material', 'adhesive_type', 'width_mm', 'color'].every((field) => structuredProductMigration.includes(field)) && inventory.includes("action === 'filter_options'") && inventoryTable.includes('组合筛选')) pass('产品结构化字段、筛选选项与组合筛选链路完整');
else fail('产品结构化字段或组合筛选链路不完整');

const app = read('src/App.jsx');
const header = read('src/components/header/Header.jsx');
const inventoryApi = read('src/lib/inventoryApi.js');
const supabaseClient = read('src/lib/supabaseClient.js');
const errorBoundary = read('src/components/common/GlobalErrorBoundary.jsx');
const loginPage = read('src/pages/LoginPage.jsx');
if (app.includes('subscribeAuth') && app.includes('subscription?.unsubscribe()') && app.includes("event === 'PASSWORD_RECOVERY'")) pass('前端监听登录状态与密码恢复事件并清理订阅');
else fail('前端缺少登录会话状态监听或清理');
if (inventoryApi.includes("window.location.pathname}#/") && !inventoryApi.includes('Calling action:')) pass('密码重置兼容 HashRouter 且不记录业务载荷');
else fail('密码重置回跳或业务载荷日志仍有风险');
if (errorBoundary.includes("window.location.hash = '#/'") && errorBoundary.includes("}).catch(() =>")) pass('全局错误页兼容 HashRouter 并兜底上报失败');
else fail('全局错误页导航或上报兜底不完整');
if (loginPage.includes("errorCode === 'otp_expired'") && loginPage.includes('此密码重置链接已失效')) pass('登录页可识别并提示失效的密码重置链接');
else fail('登录页缺少密码重置链接失效提示');
if (loginPage.includes('/email rate limit exceeded/i') && loginPage.includes('重置邮件发送过于频繁')) pass('登录页可将邮件限流错误转换为中文提示');
else fail('登录页缺少邮件发送限流中文提示');
if (!app.includes('/v2/inbox') && !app.includes('/v2/ocr-review') && !header.includes('单据收件箱')) pass('单据收件箱及 OCR 审核入口已从导航和路由移除');
else fail('单据收件箱或 OCR 审核入口仍然可访问');
if (productionPage && read('src/pages/WorkflowCenterPage.jsx').includes('saveViewingDraft') && read('src/pages/WorkflowCenterPage.jsx').includes('保存修改')) pass('业务单据详情支持草稿编辑与保存');
else fail('业务单据详情缺少草稿编辑保存能力');
if (!app.includes('/v2/inventory') && !header.includes('全状态看板')) pass('全状态看板已从导航和路由移除');
else fail('全状态看板入口仍然可访问');
const wmsApi = read('src/lib/wmsV2Api.js');
const qualityPage = read('src/pages/QualityControlPage.jsx');
if (wmsApi.includes('Promise.race') && wmsApi.includes('服务响应超时') && qualityPage.includes('质检数据加载失败')) pass('质检请求具备超时与可重试错误提示');
else fail('质检页面仍可能无限加载且无错误提示');
if (app.includes('登录状态检查超时') && app.includes('setAuthRetry') && app.includes('认证回调内部持有 Supabase 会话锁')) pass('应用启动认证避免回调锁死并支持超时重试');
else fail('应用启动认证仍可能永久卡住');
if (supabaseClient.includes('lock: async') && supabaseClient.includes('fn()')) pass('Supabase 客户端绕过浏览器遗留的跨标签认证锁');
else fail('Supabase 客户端仍可能受浏览器跨标签认证锁影响');
const approvalMigration = read('supabase/migrations/20260813103000_harden_three_level_approval.sql');
const workflowNotificationMigration = read('supabase/migrations/20260813120000_persistent_workflow_notifications.sql');
const finalWorkflowMigration = read('supabase/migrations/20260813170000_harden_workflow_and_void.sql');
const atomicWorkflowMigration = read('supabase/migrations/20260813180000_atomic_workflow_draft_update.sql');
const adminDirectApprovalMigration = read('supabase/migrations/20260821110000_admin_direct_approval.sql');
const workflowAction = read('supabase/functions/workflow-action/index.ts');
const workflowPage = read('src/pages/WorkflowCenterPage.jsx');
if (approvalMigration.includes('enforce_inventory_document_status_flow') && approvalMigration.includes("old.status='rejected'") && workflowPage.includes('提交仓管复核') && adminDirectApprovalMigration.includes("v_role is distinct from 'admin'") && adminDirectApprovalMigration.includes('v_doc.created_by <> p_actor_id') && workflowAction.includes("db.rpc('admin_approve_own_inventory_draft'")) pass('员工与仓管执行三级审核，管理员仅可直接审核自己创建的草稿');
else fail('单据审核流程或管理员受限直审通道不完整');
if (workflowNotificationMigration.includes('workflow_notifications') && workflowNotificationMigration.includes('workflow_approval_events') && workflowNotificationMigration.includes('supabase_realtime') && workflowAction.includes("action === 'approval_timeline'") && workflowAction.includes("action === 'notifications'")) pass('持久通知、实时提醒与不可变审批时间线链路完整');
else fail('持久通知、实时提醒或审批时间线链路不完整');
if (finalWorkflowMigration.includes("new.status is distinct from 'draft'") && finalWorkflowMigration.includes('is_reversal') && !finalWorkflowMigration.includes('v_new_doc_id') && finalWorkflowMigration.includes('actor_id, actor_name')) pass('外部导入强制草稿且红冲使用规范反向流水');
else fail('外部导入状态或红冲反向流水仍存在绕过/兼容风险');
if (atomicWorkflowMigration.includes('update_inventory_document_draft_atomic') && atomicWorkflowMigration.includes('for update') && atomicWorkflowMigration.includes('jsonb_array_elements') && workflowAction.includes("db.rpc('update_inventory_document_draft_atomic'") && !workflowAction.includes('const restoreDraft')) pass('草稿单据头与明细通过数据库事务原子更新');
else fail('草稿单据更新仍可能产生单据头与明细不一致');
if (atomicWorkflowMigration.includes("old.status = 'draft' and new.status = 'pending'") && atomicWorkflowMigration.includes("old.status = 'approved' and new.status = 'posted'") && atomicWorkflowMigration.includes('单据至少需要一条有效明细')) pass('数据库状态机阻止空单提交及空单入账');
else fail('数据库状态机缺少空单提交或入账保护');
if (/\bX\b/.test(workflowPage.split('\n').find((line) => line.includes("from 'lucide-react'")) || '') && workflowPage.includes('<X size=')) pass('业务页面关闭图标已正确导入');
else fail('业务页面使用了未导入的关闭图标');
const partnerPage = read('src/pages/PartnerLedgerPage.jsx');
if (app.includes('/partners') && header.includes('往来单位') && partnerPage.includes('已入账收货量') && partnerPage.includes('inventory_document_lines')) pass('往来单位板块支持公司汇总与单据流水明细');
else fail('往来单位汇总或流水明细入口不完整');
const accountSecurity = read('src/components/sync/AccountSecurity.jsx');
if (inventory.includes("action === 'user_reset_password'") && inventory.includes('signInWithPassword') && inventory.includes('updateUserById') && inventory.includes('auth.admin.listUsers') && accountSecurity.includes('原密码不可查看') && accountSecurity.includes('resetUserPassword')) pass('账号列表显示真实登录邮箱，并支持管理员二次验证后安全重设临时密码');
else fail('账号邮箱展示或安全重设临时密码链路不完整');
if (header.includes('setUnreadNotificationCount((current) => Math.max(0, current - 1))') && header.includes('{unreadNotificationCount > 0 &&') && header.includes("badge: unreadNotificationCount") && !header.includes('Math.max(pendingApprovalCount, unreadNotificationCount)')) pass('通知点击后即时消除顶部及菜单未读角标，待办数量与未读数分离');
else fail('通知角标仍可能混入审批待办或点击后不能即时消除');

console.log(`\n鑫威管理系统 Stage 2 预检`);
console.log(`通过：${passes.length} 项`);
for (const item of passes) console.log(`  ✓ ${item}`);
if (failures.length) {
  console.error(`失败：${failures.length} 项`);
  for (const item of failures) console.error(`  ✗ ${item}`);
  process.exitCode = 1;
} else {
  console.log('失败：0 项');
}
