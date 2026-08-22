-- Secure inventory workflow: raw inventory data stays behind the Edge Function.
-- Browser clients never receive direct table access to this sensitive cross-user data.

alter table public.profiles
  add column if not exists role text not null default 'staff';

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'staff'));

revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;

create table if not exists public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  image_path text,
  category text not null default '未分类',
  spec text not null default '',
  stock numeric not null default 0 check (stock >= 0),
  unit text not null default '件',
  price numeric(12, 2) not null default 0 check (price >= 0),
  source text not null default '',
  status text not null default 'Out of Stock' check (status in ('In Stock', 'High Stock', 'Low Stock', 'Out of Stock')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_activity (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.inventory_products(id) on delete set null,
  sku text not null,
  product_name text not null,
  action text not null check (action in ('IN', 'EDIT', 'OUT')),
  quantity_label text not null default '',
  detail text not null default '',
  changes text not null default '',
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists inventory_products_category_idx on public.inventory_products(category);
create index if not exists inventory_activity_created_at_idx on public.inventory_activity(created_at desc);

alter table public.inventory_products enable row level security;
alter table public.inventory_activity enable row level security;

revoke all on table public.inventory_products from anon;
revoke all on table public.inventory_products from authenticated;
revoke all on table public.inventory_activity from anon;
revoke all on table public.inventory_activity from authenticated;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', false)
on conflict (id) do update set public = false;

revoke all on table storage.objects from anon;
revoke all on table storage.objects from authenticated;
;
