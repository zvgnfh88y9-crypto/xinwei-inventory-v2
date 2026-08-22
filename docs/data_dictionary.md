# 鑫威库存管理系统 v2.8 数据字段定义 (核心)

## 1. 产品库存表 (inventory_products)
| 字段名 | 类型 | 说明 | 计算逻辑 |
| :--- | :--- | :--- | :--- |
| `stock` | numeric | **物理总库存** | 仓库内实物总数，资产核算依据。 |
| `available_stock`| numeric | **可用库存** | `stock - locked_stock - inspect_stock - defective_stock` |
| `locked_stock` | numeric | **锁定库存** | 已下单但尚未发货出库的预占数量。 |
| `retail_stock` | numeric | **零售仓库存** | 专门划拨给零售端使用的独立库存。 |
| `price` | numeric | **销售价/单价** | 前端展示与零售参考价格。 |
| `cost_price` | numeric | **成本价** | 用于财务报表与库龄分析的资产基准。 |

## 2. 业务单据表 (inventory_documents)
| 字段名 | 类型 | 说明 | 枚举值 |
| :--- | :--- | :--- | :--- |
| `document_type` | text | 单据类型 | `receipt` (收货), `shipment` (出货), `stock_count` (盘点) |
| `status` | text | 单据状态 | `draft` (草稿), `pending` (待审), `posted` (已入账), `voided` (红冲) |
| `is_reversal` | bool | 是否红冲 | `true` 代表是对冲修正单据。 |
