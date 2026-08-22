# Setup Checklist

This project is delivered in stages so beginners can see the site before cloud setup.

## 1. Local Preview

- Build locally with `node scripts/site.js build --cwd <project>`.
- Start preview with `node scripts/site.js preview:start --cwd <project> --mode vite`.
- Keep the preview running until a public URL is verified.

## 2. Supabase Activation

Use this only when the site needs real products, inventory, orders, auth, or user-owned data.

The agent first checks product authorization:

```bash
accio-mcp-cli server supabase
```

If Supabase is not connected, open Accio, go to the Accio Site Builder plugin, connect Supabase, and finish authorization. If connected, the Agent should run `accio-mcp-cli search supabase` to query tool usage, then use Supabase MCP tools such as `get_project_url`, `get_publishable_keys`, `list_tables`, `list_migrations`, `apply_migration`, `execute_sql`, `generate_typescript_types`, `deploy_edge_function`, `get_logs`, and `get_advisors`.

Never paste `SUPABASE_SERVICE_ROLE_KEY`, database passwords, connection strings, or account access tokens in chat.

## 3. Commerce Requests

This plugin does not generate online payment, cart, checkout, or payment placeholder flows. For commerce-shaped sites, use product/service display, inquiry forms, booking requests, or off-site contact links.

## 4. Site Publish

Two equivalent ways to get a public URL:

- The user clicks the product UI publish button.
- When host builtin `web_builder_publish` is visible/available, the agent asks for explicit consent, then publishes and reports the public URL.

Keep the local preview running until the public URL is verified.

Company-domain subdomains from site publish are supported. Binding a user's own domain is not supported yet. If asked to bind their own domain, do not guide DNS/CNAME setup; say that feature is in development and coming later.

## Completion

Final handoff should include `Access:` with either a public URL, a still-running local preview URL,
or a blocker plus the exact next action.
