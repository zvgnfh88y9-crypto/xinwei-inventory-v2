# Stage 2 本地验证报告

验证日期：2026-08-11

## 已通过

- `npm run preflight`：24 项通过，0 项失败。
- 使用 TypeScript 解析器对 `src` 与 `supabase/functions` 下 39 个 JS/JSX/TS 文件做语法解析：0 个语法错误。
- 检查确认交付目录中不存在 `token.txt`、`.env.local`、`node_modules`。
- 检查确认 `run_migration`、`reset_system_passwords` 不存在可执行 action 分支。
- 检查确认前端 API、Edge action、0016 RPC 的第二阶段闭环接口均存在。

## 当前环境无法完成的验证

### 1. 完整 Vite 生产构建

当前执行环境无法正常从 npm registry 安装项目依赖，`npm ci` 超时，因此没有把本地语法检查冒充成“生产构建成功”。

在可联网的部署机执行：

```bash
npm ci
npm run preflight
npm run build
```

### 2. 真实 Supabase 数据迁移

本次没有连接/修改用户的真实 Supabase 项目，因此 `0016` 尚未在真实数据库执行。

正式执行前必须：

- 备份数据库；
- 检查无归属的 Stage 1 `locked` 余额；
- 先在测试项目跑 `0014 -> 0015 -> 0016`；
- 按 `DEPLOY_STAGE2.md` 的 A/B/C 三组用例验收。
