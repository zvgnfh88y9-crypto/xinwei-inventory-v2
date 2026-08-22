create table if not exists public.wechat_mini_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  openid text not null unique,
  unionid text,
  session_key_encrypted text,
  last_login_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists wechat_mini_identities_unionid_idx
  on public.wechat_mini_identities(unionid)
  where unionid is not null and unionid <> '';

alter table public.wechat_mini_identities enable row level security;
revoke all on table public.wechat_mini_identities from anon, authenticated;
grant all on table public.wechat_mini_identities to service_role;

comment on table public.wechat_mini_identities is
  'Server-only mapping between WeChat Mini Program identities and Supabase users.';

