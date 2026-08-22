-- WMS V2 reproducible schema + bridge to the legacy aggregate inventory.
-- Goal: one physical stock reality. V2 keeps status/batch detail; inventory_products keeps aggregate values for legacy pages.

-- 1) Core master data ----------------------------------------------------------
create table if not exists public.v2_product_main (
  id uuid primary key default gen_random_uuid(),
  sku_code text not null unique,
  formal_name text not null default '',
  base_unit text not null default '件',
  category text not null default '未分类',
  spec text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v2_business_partners (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null default 'customer' check (partner_type in ('customer','supplier','other')),
  partner_code text,
  name text not null,
  contact_name text not null default '',
  phone text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v2_product_aliases (
  id uuid primary key default gen_random_uuid(),
  sku_code text not null references public.v2_product_main(sku_code) on update cascade on delete restrict,
  alias_name text not null,
  partner_id uuid references public.v2_business_partners(id) on delete set null,
  alias_type text not null default 'ocr_raw',
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (sku_code, alias_name)
);
-- 2) Source document/OCR -------------------------------------------------------
create table if not exists public.v2_source_documents (
  id uuid primary key default gen_random_uuid(),
  file_url text not null,
  file_hash text not null unique,
  file_name text not null default '',
  source_channel text not null default 'manual_upload',
  uploader_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending_ocr'
    check (status in ('pending_ocr','pending_classify','pending_match','pending_review','generated','posted','duplicated','failed','rejected','archived')),
  doc_type text,
  raw_ocr_text text not null default '',
  structured_data jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v2_source_documents_status_idx on public.v2_source_documents(status, created_at desc);
-- 3) Sales / production --------------------------------------------------------
create table if not exists public.v2_sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  customer_id uuid references public.v2_business_partners(id) on delete restrict,
  sales_person text not null default '',
  order_date date not null default current_date,
  due_date date,
  status text not null default 'confirmed' check (status in ('draft','confirmed','in_production','partially_shipped','completed','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v2_sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.v2_sales_orders(id) on delete cascade,
  sku_code text not null references public.v2_product_main(sku_code) on update cascade on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  shipped_qty numeric(14,3) not null default 0 check (shipped_qty >= 0),
  unit text not null default '件',
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);
create index if not exists v2_sales_order_lines_order_idx on public.v2_sales_order_lines(order_id);
create table if not exists public.v2_production_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  sales_order_id uuid references public.v2_sales_orders(id) on delete set null,
  sku_code text not null references public.v2_product_main(sku_code) on update cascade on delete restrict,
  plan_qty numeric(14,3) not null check (plan_qty > 0),
  actual_qty numeric(14,3) not null default 0 check (actual_qty >= 0),
  scrap_qty numeric(14,3) not null default 0 check (scrap_qty >= 0),
  workshop text not null default '',
  due_date date,
  status text not null default 'draft' check (status in ('draft','in_progress','completed','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v2_production_bom_lines (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.v2_production_orders(id) on delete cascade,
  material_sku text not null references public.v2_product_main(sku_code) on update cascade on delete restrict,
  standard_qty numeric(14,3) not null check (standard_qty > 0),
  issued_qty numeric(14,3) not null default 0 check (issued_qty >= 0),
  unit text not null default '件',
  created_at timestamptz not null default now()
);
create index if not exists v2_production_bom_lines_production_idx on public.v2_production_bom_lines(production_id);
-- 4) Status/batch inventory ----------------------------------------------------
create table if not exists public.v2_inventory_balances (
  id uuid primary key default gen_random_uuid(),
  sku_code text not null references public.v2_product_main(sku_code) on update cascade on delete restrict,
  warehouse text not null default '主仓库',
  bin_location text not null default '',
  status text not null default 'available'
    check (status in ('available','locked','inspecting','wip','subcontract','transit','defective','shipped')),
  batch_no text not null default '',
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sku_code, warehouse, bin_location, status, batch_no)
);
create index if not exists v2_inventory_balances_sku_idx on public.v2_inventory_balances(sku_code, warehouse, status);
-- 5) Warehouse receipt / QC ----------------------------------------------------
create table if not exists public.v2_warehouse_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  source_document_id uuid references public.v2_source_documents(id) on delete set null,
  partner_id uuid references public.v2_business_partners(id) on delete set null,
  status text not null default 'received' check (status in ('received','inspected','posted','cancelled')),
  received_at timestamptz not null default now(),
  received_by uuid references auth.users(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v2_warehouse_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.v2_warehouse_receipts(id) on delete cascade,
  sku_code text not null references public.v2_product_main(sku_code) on update cascade on delete restrict,
  received_qty numeric(14,3) not null check (received_qty > 0),
  unit text not null default '件',
  batch_no text not null default '',
  warehouse text not null default '主仓库',
  created_at timestamptz not null default now()
);
create index if not exists v2_receipt_lines_receipt_idx on public.v2_warehouse_receipt_lines(receipt_id);
create table if not exists public.v2_quality_inspections (
  id uuid primary key default gen_random_uuid(),
  inspect_no text not null unique,
  receipt_id uuid not null references public.v2_warehouse_receipts(id) on delete restrict,
  inspected_by uuid references auth.users(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','completed','cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.v2_quality_inspections alter column status set default 'draft';
create table if not exists public.v2_quality_inspection_lines (
  id uuid primary key default gen_random_uuid(),
  inspect_id uuid not null references public.v2_quality_inspections(id) on delete cascade,
  receipt_line_id uuid references public.v2_warehouse_receipt_lines(id) on delete set null,
  sku_code text not null references public.v2_product_main(sku_code) on update cascade on delete restrict,
  pass_qty numeric(14,3) not null default 0 check (pass_qty >= 0),
  fail_qty numeric(14,3) not null default 0 check (fail_qty >= 0),
  fail_reason text not null default '',
  created_at timestamptz not null default now()
);
-- Optional generic trace links for future document-chain expansion.
create table if not exists public.v2_document_links (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique(source_type, source_id, target_type, target_id)
);
-- 6) Lock V2 business tables behind Edge Functions ----------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'v2_product_main','v2_business_partners','v2_product_aliases','v2_source_documents',
    'v2_sales_orders','v2_sales_order_lines','v2_production_orders','v2_production_bom_lines',
    'v2_inventory_balances','v2_warehouse_receipts','v2_warehouse_receipt_lines',
    'v2_quality_inspections','v2_quality_inspection_lines','v2_document_links'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
  end loop;
end $$;
-- The browser may upload original evidence only to its own source-doc folder.
-- Reads/deletes remain server-side through signed URLs / Edge Functions.
grant insert on table storage.objects to authenticated;
drop policy if exists "authenticated_source_doc_upload" on storage.objects;
create policy "authenticated_source_doc_upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and name like ('source-docs/' || auth.uid()::text || '/%')
);
-- 7) Product master bridge -----------------------------------------------------
create or replace function public.v2_sync_product_master_from_legacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.v2_product_main (sku_code, formal_name, base_unit, category, spec, is_active, updated_at)
  values (new.sku, new.name, new.unit, new.category, new.spec, true, now())
  on conflict (sku_code) do update set
    formal_name = excluded.formal_name,
    base_unit = excluded.base_unit,
    category = excluded.category,
    spec = excluded.spec,
    is_active = true,
    updated_at = now();
  return new;
end;
$$;
drop trigger if exists inventory_products_sync_v2_master on public.inventory_products;
create trigger inventory_products_sync_v2_master
after insert or update of sku, name, unit, category, spec on public.inventory_products
for each row execute function public.v2_sync_product_master_from_legacy();
insert into public.v2_product_main (sku_code, formal_name, base_unit, category, spec)
select sku, name, unit, category, spec from public.inventory_products
on conflict (sku_code) do update set
  formal_name = excluded.formal_name,
  base_unit = excluded.base_unit,
  category = excluded.category,
  spec = excluded.spec,
  updated_at = now();
-- 8) Balance primitives --------------------------------------------------------
create or replace function public.v2_add_balance(
  p_sku text,
  p_warehouse text,
  p_status text,
  p_quantity numeric,
  p_batch_no text default '',
  p_bin_location text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity < 0 then raise exception '增加库存数量不能为负数'; end if;
  if p_quantity = 0 then return; end if;
  insert into public.v2_inventory_balances (sku_code, warehouse, bin_location, status, batch_no, quantity, updated_at)
  values (p_sku, coalesce(nullif(p_warehouse,''),'主仓库'), coalesce(p_bin_location,''), p_status, coalesce(p_batch_no,''), p_quantity, now())
  on conflict (sku_code, warehouse, bin_location, status, batch_no)
  do update set quantity = public.v2_inventory_balances.quantity + excluded.quantity, updated_at = now();
end;
$$;
create or replace function public.v2_consume_balance(
  p_sku text,
  p_warehouse text,
  p_status text,
  p_quantity numeric,
  p_batch_no text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_need numeric := p_quantity;
  v_row record;
  v_take numeric;
begin
  if p_quantity < 0 then raise exception '扣减库存数量不能为负数'; end if;
  if p_quantity = 0 then return; end if;

  for v_row in
    select id, quantity
    from public.v2_inventory_balances
    where sku_code = p_sku
      and warehouse = coalesce(nullif(p_warehouse,''),'主仓库')
      and status = p_status
      and quantity > 0
      and (coalesce(p_batch_no,'') = '' or batch_no = p_batch_no)
    order by case when batch_no = p_batch_no and p_batch_no <> '' then 0 else 1 end, created_at, id
    for update
  loop
    exit when v_need <= 0;
    v_take := least(v_row.quantity, v_need);
    update public.v2_inventory_balances
      set quantity = quantity - v_take, updated_at = now()
      where id = v_row.id;
    v_need := v_need - v_take;
  end loop;

  if v_need > 0 then
    raise exception 'SKU % 在 % 的 % 库存不足，还缺 %', p_sku, p_warehouse, p_status, v_need;
  end if;
end;
$$;
revoke execute on function public.v2_add_balance(text,text,text,numeric,text,text) from public, anon, authenticated;
revoke execute on function public.v2_consume_balance(text,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.v2_add_balance(text,text,text,numeric,text,text) to service_role;
grant execute on function public.v2_consume_balance(text,text,text,numeric,text) to service_role;
-- Seed detailed balances only for SKUs that have no V2 balances yet.
insert into public.v2_inventory_balances (sku_code, warehouse, status, batch_no, quantity)
select p.sku, '主仓库', 'available', 'LEGACY-OPENING', greatest(coalesce(p.available_stock, p.stock), 0)
from public.inventory_products p
where greatest(coalesce(p.available_stock, p.stock), 0) > 0
  and not exists (select 1 from public.v2_inventory_balances b where b.sku_code = p.sku)
on conflict do nothing;
insert into public.v2_inventory_balances (sku_code, warehouse, status, batch_no, quantity)
select p.sku, '零售仓', 'available', 'LEGACY-OPENING', greatest(coalesce(p.retail_stock,0), 0)
from public.inventory_products p
where greatest(coalesce(p.retail_stock,0), 0) > 0
  and not exists (select 1 from public.v2_inventory_balances b where b.sku_code = p.sku and b.warehouse = '零售仓')
on conflict do nothing;
-- 9) Aggregate V2 status balances back into legacy inventory_products ----------
create or replace function public.v2_sync_legacy_aggregate_from_balances(p_sku text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
  v_locked numeric;
  v_inspecting numeric;
  v_transit numeric;
  v_defective numeric;
  v_main_physical numeric;
  v_retail numeric;
begin
  select
    coalesce(sum(quantity) filter (where warehouse = '主仓库' and status = 'available'),0),
    coalesce(sum(quantity) filter (where warehouse = '主仓库' and status = 'locked'),0),
    coalesce(sum(quantity) filter (where warehouse = '主仓库' and status = 'inspecting'),0),
    coalesce(sum(quantity) filter (where status = 'transit'),0),
    coalesce(sum(quantity) filter (where warehouse = '主仓库' and status = 'defective'),0),
    coalesce(sum(quantity) filter (where warehouse = '零售仓' and status = 'available'),0)
  into v_available, v_locked, v_inspecting, v_transit, v_defective, v_retail
  from public.v2_inventory_balances
  where sku_code = p_sku;

  v_main_physical := v_available + v_locked + v_inspecting + v_defective;

  update public.inventory_products
  set available_stock = v_available,
      locked_stock = v_locked,
      inspect_stock = v_inspecting,
      transit_stock = v_transit,
      defective_stock = v_defective,
      retail_stock = v_retail,
      stock = v_main_physical,
      status = case when v_main_physical <= 0 then 'Out of Stock'
                    when v_main_physical <= 100 then 'Low Stock'
                    when v_main_physical >= 500 then 'High Stock' else 'In Stock' end,
      updated_at = now()
  where sku = p_sku;
end;
$$;
create or replace function public.v2_balance_sync_legacy_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.v2_sync_legacy_aggregate_from_balances(old.sku_code);
    return old;
  end if;
  perform public.v2_sync_legacy_aggregate_from_balances(new.sku_code);
  if tg_op = 'UPDATE' and old.sku_code is distinct from new.sku_code then
    perform public.v2_sync_legacy_aggregate_from_balances(old.sku_code);
  end if;
  return new;
end;
$$;
drop trigger if exists v2_inventory_balance_sync_legacy on public.v2_inventory_balances;
create trigger v2_inventory_balance_sync_legacy
after insert or update or delete on public.v2_inventory_balances
for each row execute function public.v2_balance_sync_legacy_trigger();
-- 10) Mirror legacy posted movements into V2 detail ---------------------------
create or replace function public.v2_mirror_legacy_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_type text;
  v_batch text;
  v_warehouse text;
  v_is_reverse boolean := coalesce(new.is_reversal,false);
  v_qty numeric := new.quantity;
begin
  select d.document_type, coalesce(l.batch_no,''), coalesce(nullif(l.warehouse,''),'主仓库')
  into v_doc_type, v_batch, v_warehouse
  from public.inventory_documents d
  join public.inventory_document_lines l on l.id = new.line_id
  where d.id = new.document_id;

  if not found then return new; end if;

  if not v_is_reverse then
    case v_doc_type
      when 'receipt', 'production_in' then
        perform public.v2_add_balance(new.sku, v_warehouse, 'available', v_qty, v_batch, '');
      when 'shipment' then
        perform public.v2_consume_balance(new.sku, v_warehouse, 'available', v_qty, v_batch);
      when 'transfer_to_retail' then
        perform public.v2_consume_balance(new.sku, '主仓库', 'available', v_qty, v_batch);
        perform public.v2_add_balance(new.sku, '零售仓', 'available', v_qty, v_batch, '');
      when 'retail_sale' then
        perform public.v2_consume_balance(new.sku, '零售仓', 'available', v_qty, v_batch);
    end case;
  else
    case v_doc_type
      when 'receipt', 'production_in' then
        perform public.v2_consume_balance(new.sku, v_warehouse, 'available', v_qty, v_batch);
      when 'shipment' then
        perform public.v2_add_balance(new.sku, v_warehouse, 'available', v_qty, v_batch, '');
      when 'transfer_to_retail' then
        perform public.v2_consume_balance(new.sku, '零售仓', 'available', v_qty, v_batch);
        perform public.v2_add_balance(new.sku, '主仓库', 'available', v_qty, v_batch, '');
      when 'retail_sale' then
        perform public.v2_add_balance(new.sku, '零售仓', 'available', v_qty, v_batch, '');
    end case;
  end if;
  return new;
end;
$$;
drop trigger if exists inventory_movements_mirror_v2 on public.inventory_movements;
create trigger inventory_movements_mirror_v2
after insert on public.inventory_movements
for each row execute function public.v2_mirror_legacy_movement();
-- 11) V2 operational RPCs ------------------------------------------------------
create or replace function public.v2_lock_inventory(p_plan_id uuid, p_warehouse text default '主仓库')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_count integer := 0;
begin
  for v_line in select sku_code, quantity from public.v2_sales_order_lines where order_id = p_plan_id loop
    perform public.v2_consume_balance(v_line.sku_code, p_warehouse, 'available', v_line.quantity, '');
    perform public.v2_add_balance(v_line.sku_code, p_warehouse, 'locked', v_line.quantity, '', '');
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception '销售订单不存在或没有明细'; end if;
  update public.v2_sales_orders set status = 'in_production', updated_at = now() where id = p_plan_id;
  return jsonb_build_object('locked_lines', v_count);
end;
$$;
create or replace function public.v2_issue_production_materials(
  p_production_id uuid,
  p_warehouse text default '主仓库',
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.v2_production_orders%rowtype;
  v_line public.v2_production_bom_lines%rowtype;
  v_need numeric;
  v_count integer := 0;
begin
  select * into v_order from public.v2_production_orders where id = p_production_id for update;
  if not found then raise exception '生产工单不存在'; end if;
  if v_order.status <> 'draft' then raise exception '只有草稿工单可以领料开工'; end if;

  for v_line in select * from public.v2_production_bom_lines where production_id = p_production_id for update loop
    v_need := greatest(v_line.standard_qty - v_line.issued_qty, 0);
    if v_need > 0 then
      perform public.v2_consume_balance(v_line.material_sku, p_warehouse, 'available', v_need, '');
      perform public.v2_add_balance(v_line.material_sku, p_warehouse, 'wip', v_need, p_production_id::text, '');
      update public.v2_production_bom_lines set issued_qty = issued_qty + v_need where id = v_line.id;
    end if;
    v_count := v_count + 1;
  end loop;

  update public.v2_production_orders set status = 'in_progress', started_at = coalesce(started_at,now()), updated_at = now() where id = p_production_id;
  return jsonb_build_object('issued_lines', v_count);
end;
$$;
create or replace function public.v2_complete_production(
  p_production_id uuid,
  p_pass_qty numeric,
  p_fail_qty numeric default 0,
  p_warehouse text default '主仓库',
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.v2_production_orders%rowtype;
  v_line public.v2_production_bom_lines%rowtype;
  v_new_total numeric;
  v_receipt_id uuid;
  v_receipt_no text;
  v_unit text := '件';
begin
  select * into v_order from public.v2_production_orders where id = p_production_id for update;
  if not found then raise exception '生产工单不存在'; end if;
  if v_order.status <> 'in_progress' then raise exception '只有生产中的工单可以汇报完工'; end if;
  if p_pass_qty < 0 or p_fail_qty < 0 or (p_pass_qty + p_fail_qty) <= 0 then raise exception '完工数量必须大于 0'; end if;

  select coalesce(base_unit, '件') into v_unit from public.v2_product_main where sku_code = v_order.sku_code;

  -- 生产报工后的良品先进入“待检”，不能直接变成可用库存；生产报废直接进入不良品。
  if p_pass_qty > 0 then
    perform public.v2_add_balance(v_order.sku_code, p_warehouse, 'inspecting', p_pass_qty, p_production_id::text, '');

    -- 自动生成一张待质检收货记录，使生产完工 -> 质检 -> 正式入库形成闭环。
    v_receipt_no := 'PR-' || regexp_replace(v_order.order_no, '[^A-Za-z0-9_-]', '', 'g') || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    insert into public.v2_warehouse_receipts(receipt_no, status, received_by, notes)
    values (v_receipt_no, 'received', p_actor_id, '生产完工自动生成，工单：' || v_order.order_no)
    returning id into v_receipt_id;

    insert into public.v2_warehouse_receipt_lines(receipt_id, sku_code, received_qty, unit, batch_no, warehouse)
    values (v_receipt_id, v_order.sku_code, p_pass_qty, v_unit, p_production_id::text, p_warehouse);
  end if;

  if p_fail_qty > 0 then
    perform public.v2_add_balance(v_order.sku_code, p_warehouse, 'defective', p_fail_qty, p_production_id::text, '生产报废');
  end if;

  v_new_total := v_order.actual_qty + v_order.scrap_qty + p_pass_qty + p_fail_qty;
  update public.v2_production_orders
  set actual_qty = actual_qty + p_pass_qty,
      scrap_qty = scrap_qty + p_fail_qty,
      status = case when v_new_total >= plan_qty then 'completed' else 'in_progress' end,
      completed_at = case when v_new_total >= plan_qty then now() else completed_at end,
      updated_at = now()
  where id = p_production_id;

  -- 全部生产完成后再结转本工单的在制材料，避免半成品期间提前冲掉 WIP。
  if v_new_total >= v_order.plan_qty then
    for v_line in select * from public.v2_production_bom_lines where production_id = p_production_id loop
      if v_line.issued_qty > 0 then
        perform public.v2_consume_balance(v_line.material_sku, p_warehouse, 'wip', v_line.issued_qty, p_production_id::text);
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'completed_total', v_new_total,
    'status', case when v_new_total >= v_order.plan_qty then 'completed' else 'in_progress' end,
    'inspection_receipt_id', v_receipt_id
  );
end;
$$;
create or replace function public.v2_finalize_inspection(
  p_inspect_id uuid,
  p_warehouse text default '主仓库',
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inspection public.v2_quality_inspections%rowtype;
  v_line record;
  v_received numeric;
  v_inspecting numeric;
  v_count integer := 0;
begin
  select * into v_inspection from public.v2_quality_inspections where id = p_inspect_id for update;
  if not found then raise exception '质检单不存在'; end if;
  if v_inspection.status = 'completed' then raise exception '该质检单已经完成，不能重复入账'; end if;

  for v_line in
    select q.*, r.received_qty, r.batch_no
    from public.v2_quality_inspection_lines q
    left join public.v2_warehouse_receipt_lines r on r.id = q.receipt_line_id
    where q.inspect_id = p_inspect_id
  loop
    v_received := coalesce(v_line.received_qty, v_line.pass_qty + v_line.fail_qty);
    if v_line.pass_qty < 0 or v_line.fail_qty < 0 then
      raise exception 'SKU % 的质检数量不能为负数', v_line.sku_code;
    end if;
    if v_line.pass_qty + v_line.fail_qty <> v_received then
      raise exception 'SKU % 的合格+不良数量必须等于收货数量 %', v_line.sku_code, v_received;
    end if;

    select coalesce(sum(quantity),0) into v_inspecting
    from public.v2_inventory_balances
    where sku_code = v_line.sku_code
      and warehouse = p_warehouse
      and status = 'inspecting'
      and (coalesce(v_line.batch_no,'') = '' or batch_no = coalesce(v_line.batch_no,''));

    if v_inspecting < v_received then
      raise exception 'SKU % 待检库存不足：需要 %，当前 %。已阻止重复/越权入库。', v_line.sku_code, v_received, v_inspecting;
    end if;

    perform public.v2_consume_balance(v_line.sku_code, p_warehouse, 'inspecting', v_received, coalesce(v_line.batch_no,''));
    perform public.v2_add_balance(v_line.sku_code, p_warehouse, 'available', v_line.pass_qty, coalesce(v_line.batch_no,''), '质检合格');
    perform public.v2_add_balance(v_line.sku_code, p_warehouse, 'defective', v_line.fail_qty, coalesce(v_line.batch_no,''), coalesce(v_line.fail_reason,'质检不良'));
    v_count := v_count + 1;
  end loop;

  update public.v2_quality_inspections set status = 'completed', updated_at = now() where id = p_inspect_id;
  update public.v2_warehouse_receipts set status = 'inspected', updated_at = now() where id = v_inspection.receipt_id;
  return jsonb_build_object('inspected_lines', v_count);
end;
$$;
create or replace function public.v2_get_document_trace_chain(p_doc_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_source record;
begin
  select id, file_name, source_channel, status, created_at into v_source
  from public.v2_source_documents where id = p_doc_id;
  if found then
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'id', v_source.id,
      'type', 'source_document',
      'doc_no', coalesce(nullif(v_source.file_name,''), v_source.source_channel, v_source.id::text),
      'date', v_source.created_at::date,
      'status', v_source.status
    ));
  end if;
  return v_result;
end;
$$;
revoke execute on function public.v2_lock_inventory(uuid,text) from public, anon, authenticated;
revoke execute on function public.v2_issue_production_materials(uuid,text,uuid) from public, anon, authenticated;
revoke execute on function public.v2_complete_production(uuid,numeric,numeric,text,uuid) from public, anon, authenticated;
revoke execute on function public.v2_finalize_inspection(uuid,text,uuid) from public, anon, authenticated;
revoke execute on function public.v2_get_document_trace_chain(uuid) from public, anon, authenticated;
grant execute on function public.v2_lock_inventory(uuid,text) to service_role;
grant execute on function public.v2_issue_production_materials(uuid,text,uuid) to service_role;
grant execute on function public.v2_complete_production(uuid,numeric,numeric,text,uuid) to service_role;
grant execute on function public.v2_finalize_inspection(uuid,text,uuid) to service_role;
grant execute on function public.v2_get_document_trace_chain(uuid) to service_role;
