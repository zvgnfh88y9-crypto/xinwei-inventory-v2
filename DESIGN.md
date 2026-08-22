# Canvas Design Contract: 鑫威库存管理系统 (Xin Wei Inventory V2)

## Design Direction
构建一个专业、稳健且具有工业/医疗感的高效后台管理系统。视觉重心在于高对比度的数据呈现与极简的卡片化布局。核心色调采用“信赖蓝” (#2563eb)，辅以鑫威品牌橙色 (#f97316) 作为行动点点缀。设计强调功能性，采用紧凑的间距和清晰的分级，确保仓库管理员在复杂数据下能快速定位低库存风险。

## Reference Sources
- `vendor/open-design/adapter/STATIC_POLICY.md`：遵循静态资源引用与 UI 规范。
- `vendor/open-design/upstream/design-systems/clean-corporate/DESIGN.md`：选定为基础视觉系统，强调清洁感与效率。
- `vendor/open-design/upstream/design-systems/clean-corporate/tokens.css`：提取色彩、间距与圆角定义。
- `vendor/open-design/upstream/craft/anti-ai-slop.md`：确保界面文案专业，避免空洞的“现代化”描述。
- 用户 Link Research Notes：已确认 Vite/React 环境、蓝色系风格及 XW 品牌 Logo 特征。

## Design Tokens
- **Colors**:
  - `--color-primary`: `#2563eb` (鑫威蓝)
  - `--color-accent`: `#f97316` (品牌橙，用于 Logo 和关键告警)
  - `--color-bg-main`: `#f8fafc` (浅灰蓝背景)
  - `--color-surface`: `#ffffff` (纯白卡片)
  - `--color-text-base`: `#1e293b` (深灰文字)
  - `--color-text-muted`: `#64748b` (辅助文字)
  - `--color-border`: `#e2e8f0` (边框线)
  - `--color-success`: `#10b981` (正常库存)
  - `--color-warning`: `#f59e0b` (低库存)
  - `--color-danger`: `#ef4444` (缺货/断货)
- **Typography**:
  - `font-family`: `'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', system-ui, -apple-system, sans-serif`
  - `text-sm`: `0.875rem` (主体数据)
  - `text-base`: `1rem` (表单/标签)
- **Others**:
  - `--radius-card`: `0.5rem`
  - `--radius-pill`: `9999px` (胶囊标签)
  - `--shadow-sm`: `0 1px 2px 0 rgb(0 0 0 / 0.05)`

## Page Structure
1. **Login (登录页)**:
   - 居中登录卡片，半透明背景。
   - 身份切换 Tab (管理员/仓管/访客)。
   - 底纹：淡灰色 XW 品牌 Logo 水印平铺。
2. **Dashboard (仪表盘)**:
   - 顶部：面包屑导航 + 用户个人中心。
   - KPI 区域：4个带图标的指标卡片 (SKU、低库存、缺货、待处理)。
   - 图表区：左侧“分类库存占比”饼图，右侧“近期出入库趋势”折线图。
   - 底部：近期库存变动快速预览列表。
3. **Inventory (库存管理)**:
   - 顶部操作栏：多功能搜索框 + 分类筛选 + 导出/新增按钮。
   - 主体：数据表格，包含 SKU 图略、库存水平胶囊、操作项。
4. **Sync (数据同步)**:
   - 状态栏：云端连接状态指示灯。
   - 核心区：支持拖拽的 Excel 上传区域 (Dashed border)。
   - 底部：操作日志流，显示同步时间与操作员。
5. **Reports (报表导出)**:
   - 预留占位页，包含按月/周导出的报表预览模组。

## Component Plan
- `AppLayout`: 包含侧边常驻导航栏 (Sidebar) 和顶部标题栏。
- `StatCard`: 用于 Dashboard 的 KPI 展示，需包含数据增长/下降的 Trend 标识。
- `StatusPill`: `data-component="inventory-status"`，根据库存数量自动切换红/黄/绿颜色。
- `DataTable`: 封装好的响应式表格，支持移动端横向滚动。
- `WatermarkLayer`: 用于登录页背景的 CSS 水印组件。
- `UploadZone`: `data-component="sync-uploader"`，带进度条的上传交互组件。

## Copy Tone
- **Voice**: 专业、严谨、工业化。
- **Forbidden**: 严禁使用“太棒了”、“魔法般的库存”等营销词汇。
- **Examples**:
  - 使用“实时库存总数”而非“库存统计”。
  - 使用“同步记录已归档”而非“历史记录在这里”。
  - 角色名明确为“系统管理员”而非“超级用户”。

## Responsive Rules
- **Mobile (360/390px)**:
  - 侧边栏折叠为底部导航或汉堡菜单。
  - KPI 卡片改为 2x2 布局或单列堆叠。
  - 表格使用 `overflow-x-auto` 并隐藏非核心列 (如“最后修改时间”)。
- **Desktop (1024px+)**:
  - 侧边栏常驻展示，采用双栏式布局展示报表。

## Implementation Notes
- 使用 Tailwind CSS 的 `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` 实现 KPI 响应式。
- 登录页水印使用 `background-image` 配合 SVG 重复平铺，透明度设为 `0.03`。
- 表格行高需保持紧凑 (`py-3`) 以展示更多数据行。
- 确保所有交互元素 (Button, Input) 具有 `:focus-visible` 状态以符合 Accessibility 要求。

## Image Manifest
- `public/assets/images/logo-xw.svg`: `imageGenerate:Design a minimalist professional vector logo for a textile company named 'Xin Wei' featuring a stylized 'XW' monogram. Primary color blue #2563eb with a touch of orange #f97316. Corporate industrial style.`
- `public/assets/images/watermark-pattern.svg`: `imageGenerate:A very subtle and faint repeating background pattern of a minimalist 'XW' monogram logo, light gray color, suitable for a web background watermark.`
- `public/assets/images/avatar-default.png`: `unsplash:user-profile-icon`
- `public/assets/images/empty-state.svg`: `imageGenerate:A clean minimalist vector illustration showing an empty file cabinet or a search glass, used for 'no results' state in an inventory system, professional blue theme.`

## Risks / Open Questions
- **数据源**: 当前为静态 UI 模仿，需确认是否需要 Mock 数据生成器以展示真实的库存图表。
- **水印强度**: 登录页水印可能影响可访问性，需根据实际预览调整透明度。
- **表格列宽**: 纺织品 SKU 名称可能较长，需在 CSS 中预设文本溢出省略 (`truncate`) 处理。
