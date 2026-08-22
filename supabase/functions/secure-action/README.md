# secure-action Edge Function

Use this starter for sensitive writes such as inventory checks, authenticated submissions, admin actions, and third-party API calls.

## Supabase Data Access Gate

Keep public reads and simple user-owned CRUD in the browser client only when RLS is enough:

- `public_read`: public SELECT with no public writes.
- `owner_scoped_private`: `auth.uid()` ownership plus allow/deny RLS checks.

Use this Edge Function pattern for:

- `sensitive_workflow`: inventory changes, authenticated submissions, admin actions, third-party calls, or idempotent side effects.
- `admin_or_cross_user`: admin or tenant-wide operations and any read/write of another user's rows.
- `third_party_or_secret`: service-role access, provider API keys, webhooks, or external APIs.

Treat sensitive table names as Edge Function/server-only by default: `users`, `accounts`, `admins`, `operators`, `members`, `roles`, `permissions`, `profiles`, `auth`, `scripts`, `audits`, `orders`, `payments`, `subscriptions`, `inventory`, `sessions`, `tokens`, `logs`, and `webhooks`.

Do not expose a generic table proxy or direct browser-client `.from("<sensitive table>")` access. Keep a fixed action allowlist, validate payload shape, check role/ownership per action, and return only whitelisted fields.

Smoke checks before deploy claims:

- No `Authorization` header returns `401`.
- Invalid JSON or unsupported `action` returns `400`.
- Unauthorized role or cross-user access returns `403`.
- Valid logged-in request returns `200` and never prints tokens or secrets.
- Ownership/resource checks happen server-side before any write.
- idempotency is added before production for sensitive side effects.
- Service-role access stays inside the function and is never bundled into frontend code.
- Anon REST exposure audit with `?select=*&limit=0` confirms sensitive tables do not return `200` or `206`.

Deploying or changing function secrets is a remote Supabase mutation. Follow the Provider Operation Contract and ask for explicit confirmation first.
