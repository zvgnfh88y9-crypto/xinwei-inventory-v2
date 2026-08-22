# 第二阶段上线步骤

> 不要直接在唯一生产库上执行。先备份，再在测试 Supabase 项目完成以下验收。

## 0. 前提

第一阶段必须已经部署：

1. `0014_stage1_security_roles_inventory.sql`
2. `0015_wms_v2_schema_and_inventory_bridge.sql`
3. 第一阶段最新版 Edge Functions

如果第一阶段尚未正式上线，可以按 `0014 -> 0015 -> 0016` 一次性在测试库执行。

## 1. 迁移前检查旧 locked 库存

在 Supabase SQL Editor 执行：

```sql
select sku_code, warehouse, batch_no, quantity
from public.v2_inventory_balances
where status = 'locked'
  and quantity > 0
  and coalesce(batch_no,'') = '';
```

结果必须为 0 行再执行 `0016`。

原因：第一阶段旧锁库逻辑没有记录“这笔锁定库存属于哪个销售订单”。第二阶段不会自动猜测归属。

如果有结果，请先按真实业务把这些锁定库存解除/核对，再迁移。

## 2. 执行数据库迁移

执行：

```text
supabase/migrations/0016_sales_production_qc_shipping_loop.sql
```

重点确认创建/更新成功：

- `v2_sales_order_lines.locked_qty`
- `v2_production_orders.sales_order_line_id`
- `v2_shipments`
- `v2_shipment_lines`
- `v2_refresh_sales_order_status`
- `v2_lock_inventory`
- `v2_complete_production`
- `v2_finalize_inspection`
- `v2_ship_sales_order`
- `v2_confirm_shipment_delivery`

## 3. 部署 Edge Function

至少重新部署：

```text
supabase/functions/wms-v2-action/index.ts
```

第一阶段其他两个函数没有被第二阶段改动，但生产环境应继续使用第一阶段整改版：

- `inventory-action`
- `workflow-action`

## 4. 前端部署前

从 `.env.example` 创建你自己的 `.env.local`（不要提交 `.env.local`），然后执行：

```bash
npm ci
npm run preflight
npm run build
```

## 5. 第二阶段核心验收用例

准备一个测试成品 `FG-TEST` 和一个测试原料 `RM-TEST`，不要直接拿正式客户订单做第一次验收。

### 用例 A：现货足够

1. FG-TEST 可用库存 100。
2. 建销售订单 60。
3. 仓库主管点击“锁定现货”。
4. 验证：available -60，locked +60，销售行 locked_qty=60。
5. 再次点击“锁定现货”。
6. 验证：库存不再变化（幂等）。
7. 点击“出库已锁定”。
8. 验证：locked -60，shipped +60，shipped_qty=60，生成出货单。
9. 确认客户签收。
10. 验证：shipped -60，出货单状态 delivered。

### 用例 B：现货不足 + 生产补货

1. FG-TEST 可用库存 20。
2. 建销售订单 100。
3. 锁定现货。
4. 验证：locked=20，页面显示待排产缺口 80。
5. 到生产计划，选择该销售订单缺口创建 80 的生产工单并配置 RM-TEST BOM。
6. 领料开工：RM-TEST available 减少，WIP 增加。
7. 完工 80：FG-TEST inspecting 增加 80，并自动出现待质检收货单。
8. 质检 75 合格、5 不良，并填写不良原因。
9. 验证：defective +5；合格 75 自动锁给销售订单；订单还应显示 5 的新缺口。
10. 再创建 5 的补产工单，完成并质检合格。
11. 验证：销售订单总 locked 达到 100（如果前 20 尚未发货）。
12. 执行出库并确认签收。

### 用例 C：防错

- 同一订单重复锁库不能重复扣可用库存。
- 关联销售订单的生产工单不能超过当前待排产缺口。
- 生产报工不能超过剩余计划。
- 同一收货单不能重复质检。
- staff 不能调用锁库、生产执行、质检、出货或签收动作。

## 6. 上线后观察

第一天重点比对：

- `inventory_products.available_stock / locked_stock / inspect_stock / defective_stock`
- `v2_inventory_balances`
- 销售订单 `locked_qty / shipped_qty`
- 系统审计日志 `system_audit_log`

如果其中任何一处不一致，先停止继续出入库，再定位数据，不要直接手工覆盖库存字段。
