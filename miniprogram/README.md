# 鑫威库存微信小程序

第一版提供微信静默登录、送货单/出库单拍照、多图上传、按单据日期归档，以及管理员通知。

## 本地打开

1. 微信开发者工具选择“导入项目”。
2. 目录选择本仓库的 `miniprogram` 文件夹。
3. AppID 已配置为 `wxa5d07292d5a62a30`。
4. 后端服务选择“不使用云开发”；本项目复用现有 Supabase。

## 发布前配置

- 在微信公众平台将 `https://oatkrwhniidjharkautu.supabase.co` 加入“request 合法域名”。
- 先应用数据库迁移 `20260821130000_wechat_mini_program_identities.sql`。
- 部署 `wechat-auth` Edge Function，且必须关闭该函数的 JWT 网关校验；函数内部会自行完成微信登录与令牌校验。
- Supabase Secrets 必须包含 `WECHAT_APP_ID` 与 `WECHAT_APP_SECRET`。

微信 AppSecret 只能保存在 Supabase Secrets，严禁放入本目录。
