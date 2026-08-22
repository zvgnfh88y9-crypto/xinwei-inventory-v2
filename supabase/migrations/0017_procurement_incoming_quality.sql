-- Stage 3 batch 1: suppliers, purchase requests/orders, arrivals and incoming QC.
-- Apply after 0016_sales_production_qc_shipping_loop.sql.

create table if not exists public.v2_suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_no text not null unique,
  name text not null,
  contact_name text not null default '',
  phone text not null default '',
  address text not null default '',
  supplied_products text not null default '',
  cooperation_level text not null default 'B' check (cooperation_level in ('A','B','C')),
  status text not null default 'active' check (status in ('active','inactive')),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v2_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  department text not null,
  requester_name text not null,
  required_date date,
  purpose text not null default '',
  urgency text not null default 'normal' check (urgency in ('normal','urgent')),
  status text not null default 'draft' check (status in ('draft','pending','approved','rejected','ordering','completed','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approval_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v2_purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.v2_purchase_requests(id) on delete cascade,
  sku_code text not null references public.v2_product_main(sku_code) on update cascade on delete restrict,
  specification text not null default '',
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default '件',
  notes text not null default ''
);
create table if not exists public.v2_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  request_id uuid references public.v2_purchase_requests(id) on delete restrict,
  supplier_id uuid not null references public.v2_suppliers(id) on delete restrict,
  expected_date date,
  payment_note text not null default '',
  status text not null default 'ordered' check (status in ('draft','ordered','partially_received','received','completed','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.v2_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.v2_purchase_orders(id) on delete cascade,
  request_item_id uuid references public.v2_purchase_request_items(id) on delete set null,
  sku_code text not null references public.v2_product_main(sku_code) on update cascade on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  received_qty numeric(14,3) not null default 0 check (received_qty >= 0 and received_qty <= quantity),
  unit text not null default '件',
  unit_price numeric(14,4) not null default 0 check (unit_price >= 0)
);
create table if not exists public.v2_arrival_records (
  id uuid primary key default gen_random_uuid(),
  arrival_no text not null unique,
  purchase_order_id uuid references public.v2_purchase_orders(id) on delete restrict,
  supplier_id uuid not null references public.v2_suppliers(id) on delete restrict,
  receipt_id uuid not null unique references public.v2_warehouse_receipts(id) on delete restrict,
  delivery_note_no text not null default '',
  packaging_condition text not null default '',
  photo_urls jsonb not null default '[]'::jsonb,
  source_warning text not null default '',
  arrived_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.v2_purchase_inventory_links (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references public.v2_purchase_orders(id) on delete set null,
  arrival_id uuid references public.v2_arrival_records(id) on delete set null,
  receipt_id uuid references public.v2_warehouse_receipts(id) on delete set null,
  inspection_id uuid references public.v2_quality_inspections(id) on delete set null,
  sku_code text not null,
  batch_no text not null default '',
  from_status text,
  to_status text not null check (to_status in ('inspecting','available','defective')),
  quantity numeric(14,3) not null check (quantity > 0),
  created_at timestamptz not null default now()
);
create index if not exists v2_purchase_requests_status_idx on public.v2_purchase_requests(status, required_date);
create index if not exists v2_purchase_orders_status_idx on public.v2_purchase_orders(status, expected_date);
create index if not exists v2_arrivals_order_idx on public.v2_arrival_records(purchase_order_id, arrived_at);
create index if not exists v2_purchase_inventory_links_trace_idx on public.v2_purchase_inventory_links(purchase_order_id, receipt_id, inspection_id);
alter table public.v2_warehouse_receipts add column if not exists purchase_order_id uuid references public.v2_purchase_orders(id) on delete set null;
alter table public.v2_warehouse_receipts add column if not exists receipt_type text not null default 'general';
alter table public.v2_quality_inspections add column if not exists inspection_type text not null default 'general';
alter table public.v2_quality_inspections add column if not exists inspection_items jsonb not null default '[]'::jsonb;
alter table public.v2_quality_inspections add column if not exists photo_urls jsonb not null default '[]'::jsonb;
-- Server-side arrival transaction. Goods are recorded as inspecting, never available.
create or replace function public.v2_register_purchase_arrival(
  p_purchase_order_id uuid,
  p_supplier_id uuid,
  p_delivery_note_no text,
  p_packaging_condition text,
  p_lines jsonb,
  p_warehouse text,
  p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order public.v2_purchase_orders%rowtype;
  v_receipt_id uuid;
  v_arrival_id uuid;
  v_receipt_no text := 'RCV-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_arrival_no text := 'ARR-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_line jsonb;
  v_item public.v2_purchase_order_items%rowtype;
  v_qty numeric;
  v_batch text;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception '到货明细不能为空'; end if;
  select * into v_order from public.v2_purchase_orders where id = p_purchase_order_id for update;
  if not found or v_order.supplier_id <> p_supplier_id then raise exception '采购订单或供应商不匹配'; end if;
  if v_order.status not in ('ordered','partially_received') then raise exception '采购订单当前状态不允许收货'; end if;

  insert into public.v2_warehouse_receipts(receipt_no, partner_id, purchase_order_id, receipt_type, status, received_by, notes)
  values(v_receipt_no, null, p_purchase_order_id, 'purchase', 'received', p_actor_id, '采购到货，待来料检验') returning id into v_receipt_id;
  insert into public.v2_arrival_records(arrival_no, purchase_order_id, supplier_id, receipt_id, delivery_note_no, packaging_condition, created_by)
  values(v_arrival_no, p_purchase_order_id, p_supplier_id, v_receipt_id, coalesce(p_delivery_note_no,''), coalesce(p_packaging_condition,''), p_actor_id) returning id into v_arrival_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.v2_purchase_order_items where id = (v_line->>'order_item_id')::uuid and order_id = p_purchase_order_id for update;
    if not found then raise exception '到货明细不属于当前采购订单'; end if;
    v_qty := (v_line->>'quantity')::numeric;
    if v_qty <= 0 or v_item.received_qty + v_qty > v_item.quantity then raise exception 'SKU % 到货数量超过未收数量', v_item.sku_code; end if;
    v_batch := coalesce(v_line->>'batch_no','');
    insert into public.v2_warehouse_receipt_lines(receipt_id, sku_code, received_qty, unit, batch_no, warehouse)
    values(v_receipt_id, v_item.sku_code, v_qty, v_item.unit, v_batch, coalesce(nullif(p_warehouse,''),'主仓库'));
    insert into public.v2_inventory_balances(sku_code, warehouse, status, batch_no, quantity, updated_at)
    values(v_item.sku_code, coalesce(nullif(p_warehouse,''),'主仓库'), 'inspecting', v_batch, v_qty, now())
    on conflict(sku_code, warehouse, bin_location, status, batch_no) do update set quantity = public.v2_inventory_balances.quantity + excluded.quantity, updated_at = now();
    update public.v2_purchase_order_items set received_qty = received_qty + v_qty where id = v_item.id;
    insert into public.v2_purchase_inventory_links(purchase_order_id, arrival_id, receipt_id, sku_code, batch_no, to_status, quantity)
    values(p_purchase_order_id, v_arrival_id, v_receipt_id, v_item.sku_code, v_batch, 'inspecting', v_qty);
  end loop;

  if not exists(select 1 from public.v2_purchase_order_items where order_id=p_purchase_order_id and received_qty < quantity) then
    update public.v2_purchase_orders set status='received', updated_at=now() where id=p_purchase_order_id;
  else
    update public.v2_purchase_orders set status='partially_received', updated_at=now() where id=p_purchase_order_id;
  end if;
  return jsonb_build_object('arrival_id',v_arrival_id,'arrival_no',v_arrival_no,'receipt_id',v_receipt_id,'receipt_no',v_receipt_no);
end $$;
revoke all on function public.v2_register_purchase_arrival(uuid,uuid,text,text,jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.v2_register_purchase_arrival(uuid,uuid,text,text,jsonb,text,uuid) to service_role;
-- Extend inventory trace when an incoming inspection is finalized.
create or replace function public.v2_link_purchase_inspection() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='completed' and old.status is distinct from new.status then
    update public.v2_purchase_inventory_links set inspection_id=new.id
    where receipt_id=new.receipt_id and inspection_id is null;
    insert into public.v2_purchase_inventory_links(purchase_order_id,arrival_id,receipt_id,inspection_id,sku_code,batch_no,from_status,to_status,quantity)
    select r.purchase_order_id,a.id,new.receipt_id,new.id,l.sku_code,coalesce(w.batch_no,''),'inspecting','available',l.pass_qty
    from public.v2_quality_inspection_lines l
    join public.v2_warehouse_receipt_lines w on w.id=l.receipt_line_id
    join public.v2_warehouse_receipts r on r.id=new.receipt_id
    left join public.v2_arrival_records a on a.receipt_id=r.id
    where l.inspect_id=new.id and l.pass_qty > 0
    union all
    select r.purchase_order_id,a.id,new.receipt_id,new.id,l.sku_code,coalesce(w.batch_no,''),'inspecting','defective',l.fail_qty
    from public.v2_quality_inspection_lines l
    join public.v2_warehouse_receipt_lines w on w.id=l.receipt_line_id
    join public.v2_warehouse_receipts r on r.id=new.receipt_id
    left join public.v2_arrival_records a on a.receipt_id=r.id
    where l.inspect_id=new.id and l.fail_qty > 0;

    update public.v2_purchase_orders po set status='completed', updated_at=now()
    from public.v2_warehouse_receipts r
    where r.id=new.receipt_id and po.id=r.purchase_order_id
      and not exists (
        select 1 from public.v2_warehouse_receipts pending
        where pending.purchase_order_id=po.id and pending.status='received'
      )
      and not exists (
        select 1 from public.v2_purchase_order_items item
        where item.order_id=po.id and item.received_qty < item.quantity
      );
    update public.v2_purchase_requests pr set status='completed', updated_at=now()
    where exists(select 1 from public.v2_purchase_orders po where po.request_id=pr.id and po.status='completed')
      and not exists(select 1 from public.v2_purchase_orders po where po.request_id=pr.id and po.status <> 'completed');
  end if;
  return new;
end $$;
drop trigger if exists v2_purchase_inspection_link on public.v2_quality_inspections;
create trigger v2_purchase_inspection_link after update on public.v2_quality_inspections for each row execute function public.v2_link_purchase_inspection();
-- Edge functions use service_role; authenticated users have no direct table writes.
alter table public.v2_suppliers enable row level security;
alter table public.v2_purchase_requests enable row level security;
alter table public.v2_purchase_request_items enable row level security;
alter table public.v2_purchase_orders enable row level security;
alter table public.v2_purchase_order_items enable row level security;
alter table public.v2_arrival_records enable row level security;
alter table public.v2_purchase_inventory_links enable row level security;
