-- Stage 1 hardening: role consistency, account flags, workflow schema reconciliation,
-- audit/import tables, and ledger-driven inventory posting/voiding.

-- 1) Profiles / role model ----------------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'staff',
  add column if not exists must_change_password boolean not null default false,
  add column if not exists is_disabled boolean not null default false,
  add column if not exists permissions text[] default '{}',
  add column if not exists data_scope jsonb default '{"warehouse":"all"}'::jsonb;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'inv_manager', 'staff'));
-- Keep newly-created auth users least-privileged; privileged roles are assigned only by server-side admin flow.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role, must_change_password, is_disabled)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email), 'staff', false, false)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- 2) Product/inventory columns ------------------------------------------------
alter table public.inventory_products
  add column if not exists available_stock numeric(12,2) not null default 0,
  add column if not exists locked_stock numeric(12,2) not null default 0,
  add column if not exists inspect_stock numeric(12,2) not null default 0,
  add column if not exists transit_stock numeric(12,2) not null default 0,
  add column if not exists defective_stock numeric(12,2) not null default 0,
  add column if not exists retail_stock numeric(12,2) not null default 0,
  add column if not exists retail_price numeric(12,2) not null default 0,
  add column if not exists cost_price numeric(12,2) not null default 0;
-- Existing installations that predate available_stock should start from main warehouse physical stock.
update public.inventory_products
set available_stock = stock
where available_stock = 0
  and stock > 0
  and coalesce(locked_stock,0) = 0
  and coalesce(inspect_stock,0) = 0
  and coalesce(defective_stock,0) = 0;
-- 3) Workflow schema reconciliation -------------------------------------------
alter table public.inventory_documents
  add column if not exists inbound_person text not null default '',
  add column if not exists image_path text not null default '',
  add column if not exists batch_no text,
  add column if not exists original_doc_id uuid references public.inventory_documents(id),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists audit_log jsonb not null default '[]'::jsonb;
alter table public.inventory_documents drop constraint if exists inventory_documents_document_type_check;
alter table public.inventory_documents
  add constraint inventory_documents_document_type_check
  check (document_type in ('receipt', 'production_in', 'shipment', 'transfer_to_retail', 'retail_sale'));
alter table public.inventory_documents drop constraint if exists inventory_documents_status_check;
alter table public.inventory_documents
  add constraint inventory_documents_status_check
  check (status in ('draft', 'pending', 'approved', 'posted', 'rejected', 'cancelled', 'voided'));
alter table public.inventory_movements
  add column if not exists is_reversal boolean not null default false,
  add column if not exists reason_code text,
  add column if not exists notes text not null default '';
-- The original unique(document_id,line_id) prevented a reversal row for the same line.
alter table public.inventory_movements drop constraint if exists inventory_movements_document_id_line_id_key;
create unique index if not exists inventory_movements_original_line_uq
  on public.inventory_movements(document_id, line_id)
  where is_reversal = false;
-- 4) Server-only operational logs ---------------------------------------------
create table if not exists public.system_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null default '',
  action_type text not null,
  resource_type text not null default '',
  resource_id text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists system_audit_log_created_at_idx on public.system_audit_log(created_at desc);
create index if not exists system_audit_log_actor_idx on public.system_audit_log(actor_id, created_at desc);
alter table public.system_audit_log enable row level security;
revoke all on table public.system_audit_log from public, anon, authenticated;
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique,
  file_name text not null default '',
  imported_by uuid references auth.users(id) on delete set null,
  total_rows integer not null default 0,
  success_rows integer not null default 0,
  failed_rows integer not null default 0,
  error_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists import_batches_created_at_idx on public.import_batches(created_at desc);
alter table public.import_batches enable row level security;
revoke all on table public.import_batches from public, anon, authenticated;
-- 5) Canonical ledger-driven posting ------------------------------------------
create or replace function public.post_inventory_document(
  p_document_id uuid,
  p_actor_id uuid,
  p_actor_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.inventory_documents%rowtype;
  v_line public.inventory_document_lines%rowtype;
  v_product public.inventory_products%rowtype;
  v_before numeric;
  v_after numeric;
  v_direction text;
  v_note text;
  v_line_count integer := 0;
  v_total numeric := 0;
begin
  select * into v_doc from public.inventory_documents where id = p_document_id for update;
  if not found then raise exception '单据不存在'; end if;
  if v_doc.status <> 'approved' then raise exception '只有已审核单据可以入账'; end if;

  for v_line in select * from public.inventory_document_lines where document_id = p_document_id order by created_at loop
    select * into v_product from public.inventory_products where lower(trim(sku)) = lower(trim(v_line.sku)) for update;
    if not found then raise exception '产品编号不存在：%', v_line.sku; end if;

    case v_doc.document_type
      when 'receipt', 'production_in' then
        v_before := v_product.stock;
        v_after := v_product.stock + v_line.quantity;
        v_direction := 'in';
        v_note := '主仓入库';
        update public.inventory_products
        set stock = stock + v_line.quantity,
            available_stock = available_stock + v_line.quantity,
            status = case when stock + v_line.quantity <= 0 then 'Out of Stock'
                          when stock + v_line.quantity <= 100 then 'Low Stock'
                          when stock + v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
            updated_by = p_actor_id,
            updated_at = now()
        where id = v_product.id;

      when 'shipment' then
        if v_product.available_stock < v_line.quantity or v_product.stock < v_line.quantity then
          raise exception '产品 % 可用库存不足：当前可用 %，出库 %', v_line.sku, v_product.available_stock, v_line.quantity;
        end if;
        v_before := v_product.stock;
        v_after := v_product.stock - v_line.quantity;
        v_direction := 'out';
        v_note := '主仓出库';
        update public.inventory_products
        set stock = stock - v_line.quantity,
            available_stock = available_stock - v_line.quantity,
            status = case when stock - v_line.quantity <= 0 then 'Out of Stock'
                          when stock - v_line.quantity <= 100 then 'Low Stock'
                          when stock - v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
            updated_by = p_actor_id,
            updated_at = now()
        where id = v_product.id;

      when 'transfer_to_retail' then
        if v_product.available_stock < v_line.quantity or v_product.stock < v_line.quantity then
          raise exception '产品 % 主仓可用库存不足：当前可用 %，调拨 %', v_line.sku, v_product.available_stock, v_line.quantity;
        end if;
        v_before := v_product.stock;
        v_after := v_product.stock - v_line.quantity;
        v_direction := 'out';
        v_note := '主仓调拨至零售仓';
        update public.inventory_products
        set stock = stock - v_line.quantity,
            available_stock = available_stock - v_line.quantity,
            retail_stock = retail_stock + v_line.quantity,
            status = case when stock - v_line.quantity <= 0 then 'Out of Stock'
                          when stock - v_line.quantity <= 100 then 'Low Stock'
                          when stock - v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
            updated_by = p_actor_id,
            updated_at = now()
        where id = v_product.id;

      when 'retail_sale' then
        if v_product.retail_stock < v_line.quantity then
          raise exception '产品 % 零售仓库存不足：当前 %，出库 %', v_line.sku, v_product.retail_stock, v_line.quantity;
        end if;
        v_before := v_product.retail_stock;
        v_after := v_product.retail_stock - v_line.quantity;
        v_direction := 'out';
        v_note := '零售仓出库';
        update public.inventory_products
        set retail_stock = retail_stock - v_line.quantity,
            updated_by = p_actor_id,
            updated_at = now()
        where id = v_product.id;

      else
        raise exception '不支持的单据类型：%', v_doc.document_type;
    end case;

    insert into public.inventory_movements (
      document_id, line_id, sku, direction, quantity, before_stock, after_stock,
      business_date, actor_id, actor_name, is_reversal, notes
    ) values (
      v_doc.id, v_line.id, v_line.sku, v_direction, v_line.quantity, v_before, v_after,
      v_doc.business_date, p_actor_id, coalesce(p_actor_name,''), false, v_note
    );

    insert into public.inventory_activity (product_id, sku, product_name, action, quantity_label, detail, changes, actor_id, actor_name)
    values (
      v_product.id, v_line.sku, coalesce(nullif(v_line.product_name,''), v_product.name),
      case when v_direction = 'in' then 'IN' else 'OUT' end,
      case when v_direction = 'in' then '+' else '-' end || v_line.quantity::text,
      v_note || ' · ' || v_doc.doc_no,
      '余额：' || v_before::text || ' → ' || v_after::text,
      p_actor_id, coalesce(p_actor_name,'')
    );

    v_line_count := v_line_count + 1;
    v_total := v_total + v_line.quantity;
  end loop;

  update public.inventory_documents
  set status = 'posted', posted_by = p_actor_id, posted_at = now(), updated_at = now()
  where id = v_doc.id;

  return jsonb_build_object('success', true, 'document_id', v_doc.id, 'doc_no', v_doc.doc_no, 'line_count', v_line_count, 'total_quantity', v_total);
end;
$$;
revoke execute on function public.post_inventory_document(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.post_inventory_document(uuid, uuid, text) to service_role;
-- 6) Canonical reversal/void ---------------------------------------------------
create or replace function public.void_inventory_document(
  p_document_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.inventory_documents%rowtype;
  v_line public.inventory_document_lines%rowtype;
  v_product public.inventory_products%rowtype;
  v_before numeric;
  v_after numeric;
  v_direction text;
begin
  select * into v_doc from public.inventory_documents where id = p_document_id for update;
  if not found then raise exception '单据不存在'; end if;
  if v_doc.status <> 'posted' then raise exception '只有已入账单据可以红冲作废'; end if;

  for v_line in select * from public.inventory_document_lines where document_id = p_document_id order by created_at loop
    select * into v_product from public.inventory_products where lower(trim(sku)) = lower(trim(v_line.sku)) for update;
    if not found then raise exception '产品编号不存在：%', v_line.sku; end if;

    case v_doc.document_type
      when 'receipt', 'production_in' then
        if v_product.stock < v_line.quantity or v_product.available_stock < v_line.quantity then
          raise exception '产品 % 当前库存已被后续业务占用，无法红冲该入库单', v_line.sku;
        end if;
        v_before := v_product.stock;
        v_after := v_product.stock - v_line.quantity;
        v_direction := 'out';
        update public.inventory_products
        set stock = stock - v_line.quantity,
            available_stock = available_stock - v_line.quantity,
            status = case when stock - v_line.quantity <= 0 then 'Out of Stock'
                          when stock - v_line.quantity <= 100 then 'Low Stock'
                          when stock - v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
            updated_by = p_actor_id, updated_at = now()
        where id = v_product.id;

      when 'shipment' then
        v_before := v_product.stock;
        v_after := v_product.stock + v_line.quantity;
        v_direction := 'in';
        update public.inventory_products
        set stock = stock + v_line.quantity,
            available_stock = available_stock + v_line.quantity,
            status = case when stock + v_line.quantity <= 0 then 'Out of Stock'
                          when stock + v_line.quantity <= 100 then 'Low Stock'
                          when stock + v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
            updated_by = p_actor_id, updated_at = now()
        where id = v_product.id;

      when 'transfer_to_retail' then
        if v_product.retail_stock < v_line.quantity then
          raise exception '产品 % 零售仓库存已被后续业务占用，无法红冲调拨单', v_line.sku;
        end if;
        v_before := v_product.stock;
        v_after := v_product.stock + v_line.quantity;
        v_direction := 'in';
        update public.inventory_products
        set stock = stock + v_line.quantity,
            available_stock = available_stock + v_line.quantity,
            retail_stock = retail_stock - v_line.quantity,
            status = case when stock + v_line.quantity <= 0 then 'Out of Stock'
                          when stock + v_line.quantity <= 100 then 'Low Stock'
                          when stock + v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
            updated_by = p_actor_id, updated_at = now()
        where id = v_product.id;

      when 'retail_sale' then
        v_before := v_product.retail_stock;
        v_after := v_product.retail_stock + v_line.quantity;
        v_direction := 'in';
        update public.inventory_products
        set retail_stock = retail_stock + v_line.quantity,
            updated_by = p_actor_id, updated_at = now()
        where id = v_product.id;

      else
        raise exception '不支持的单据类型：%', v_doc.document_type;
    end case;

    insert into public.inventory_movements (
      document_id, line_id, sku, direction, quantity, before_stock, after_stock,
      business_date, actor_id, actor_name, is_reversal, reason_code, notes
    ) values (
      v_doc.id, v_line.id, v_line.sku, v_direction, v_line.quantity, v_before, v_after,
      current_date, p_actor_id, '', true, 'VOID', '红冲：' || coalesce(p_reason,'')
    );
  end loop;

  update public.inventory_documents
  set status = 'voided', voided_at = now(), voided_by = p_actor_id,
      notes = case when coalesce(p_reason,'') = '' then notes else p_reason end,
      updated_at = now()
  where id = v_doc.id;

  return jsonb_build_object('success', true, 'document_id', v_doc.id, 'doc_no', v_doc.doc_no);
end;
$$;
revoke execute on function public.void_inventory_document(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.void_inventory_document(uuid, uuid, text) to service_role;
