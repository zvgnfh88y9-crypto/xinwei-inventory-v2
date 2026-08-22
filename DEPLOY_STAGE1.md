# 第一阶段上线顺序

## 0. 先备份

请先在 Supabase 做数据库备份/导出。不要直接在唯一生产库上裸执行库存迁移。

## 1. 数据库迁移

在测试库确认原有 `0001`～`0013` 已存在后，执行：

1. `supabase/migrations/0014_stage1_security_roles_inventory.sql`
2. `supabase/migrations/0015_wms_v2_schema_and_inventory_bridge.sql`

`0015` 会把没有 V2 余额的旧 SKU 以 `LEGACY-OPENING` 作为期初余额迁入 V2；已有 V2 余额的 SKU 不会重复导入期初余额。

## 2. Edge Functions

部署最新源码：

- `supabase/functions/inventory-action/index.ts`
- `supabase/functions/workflow-action/index.ts`
- `supabase/functions/wms-v2-action/index.ts`

确认运行环境存在：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`（inventory/workflow 使用）
- `SUPABASE_SERVICE_ROLE_KEY`

## 3. 前端

从 `.env.example` 创建本地 `.env.local`，填写前端需要的公开配置，然后：

```bash
npm ci
npm run build
```

## 4. 验收用例

至少逐项测试：

- admin / inv_manager / staff 三种角色登录与越权访问。
- 新账号首次登录强制改密。
- 编辑已有产品资料，确认库存数量不变。
- Excel 导入已有 SKU，确认库存数量不变。
- 新建入库单 → 提交 → 审核 → 入账，旧库存和 V2 可用库存同步增加。
- 新建出库单 → 提交 → 审核 → 入账，旧库存和 V2 可用库存同步减少。
- 红冲上述单据，确认两个库存视图都恢复。
- 生产领料后原料进入 WIP；生产完工良品进入 inspecting；质检后 pass 进入 available、fail 进入 defective。
- 普通员工不能进入系统管理/审核/质检/异常中心，也不能修改其他员工上传的 OCR 原始凭证。
