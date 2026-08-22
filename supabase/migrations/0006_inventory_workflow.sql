-- Inventory workflow: receiving, production inbound, shipment, approval, posting and immutable movements.
create table if not exists public.inventory_documents (
  id uuid primary key default gen_random_uuid(),
  doc_no text not null unique,
  document_type text not null check (document_type in ('receipt', 'production_in', 'shipment')),
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'posted', 'rejected', 'cancelled')),
  business_date date not null default current_date,
  partner_name text not null default '',
  order_no text not null default '',
  source_file_name text not null default '',
  source_file_type text not null default '',
  notes text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  submitted_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  posted_by uuid references auth.users(id) on delete set null,
  rejected_by uuid references auth.users(id) on delete set null,
  rejection_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  posted_at timestamptz
);
create table if not exists public.inventory_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.inventory_documents(id) on delete cascade,
  sku text not null,
  product_name text not null default '',
  quantity numeric not null check (quantity > 0),
  unit text not null default '件',
  batch_no text not null default '',
  warehouse text not null default '',
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.inventory_documents(id) on delete restrict,
  line_id uuid not null references public.inventory_document_lines(id) on delete restrict,
  sku text not null,
  direction text not null check (direction in ('in', 'out')),
  quantity numeric not null check (quantity > 0),
  before_stock numeric not null,
  after_stock numeric not null,
  business_date date not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null default '',
  created_at timestamptz not null default now(),
  unique(document_id, line_id)
);
create index if not exists inventory_documents_date_idx on public.inventory_documents(business_date desc);
create index if not exists inventory_documents_status_idx on public.inventory_documents(status);
create index if not exists inventory_document_lines_document_idx on public.inventory_document_lines(document_id);
create index if not exists inventory_movements_date_idx on public.inventory_movements(business_date desc);
create index if not exists inventory_movements_sku_idx on public.inventory_movements(sku);
alter table public.inventory_documents enable row level security;
alter table public.inventory_document_lines enable row level security;
alter table public.inventory_movements enable row level security;
revoke all on table public.inventory_documents from anon;
revoke all on table public.inventory_documents from authenticated;
revoke all on table public.inventory_document_lines from anon;
revoke all on table public.inventory_document_lines from authenticated;
revoke all on table public.inventory_movements from anon;
revoke all on table public.inventory_movements from authenticated;
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
  doc record;
  line record;
  product record;
  direction_value text;
  before_value numeric;
  after_value numeric;
  total_value numeric := 0;
  line_count integer := 0;
begin
  select * into doc from public.inventory_documents where id = p_document_id for update;
  if not found then raise exception '单据不存在'; end if;
  if doc.status <> 'approved' then raise exception '只有已审核单据可以入账'; end if;

  for line in select * from public.inventory_document_lines where document_id = doc.id loop
    select * into product from public.inventory_products where sku = line.sku for update;
    if not found then raise exception '产品编号不存在：%', line.sku; end if;

    direction_value := case when doc.document_type = 'shipment' then 'out' else 'in' end;
    before_value := product.stock;
    if direction_value = 'out' then
      if product.stock < line.quantity then raise exception '库存不足：%，当前库存 %，出货数量 %', line.sku, product.stock, line.quantity; end if;
      after_value := product.stock - line.quantity;
    else
      after_value := product.stock + line.quantity;
    end if;

    update public.inventory_products
      set stock = after_value,
          status = case when after_value <= 0 then 'Out of Stock' when after_value <= 100 then 'Low Stock' when after_value >= 500 then 'High Stock' else 'In Stock' end,
          updated_by = p_actor_id,
          updated_at = now()
      where sku = line.sku;

    insert into public.inventory_movements (document_id, line_id, sku, direction, quantity, before_stock, after_stock, business_date, actor_id, actor_name)
    values (doc.id, line.id, line.sku, direction_value, line.quantity, before_value, after_value, doc.business_date, p_actor_id, coalesce(p_actor_name, ''));

    insert into public.inventory_activity (sku, product_name, action, quantity_label, detail, changes, actor_id, actor_name)
    values (
      line.sku,
      coalesce(line.product_name, product.name),
      case when direction_value = 'out' then 'OUT' else 'IN' end,
      case when direction_value = 'out' then '-' else '+' end || line.quantity::text,
      case when direction_value = 'out' then '出货单入账 ' else '入库单入账 ' end || doc.doc_no,
      '库存：' || before_value::text || ' → ' || after_value::text,
      p_actor_id,
      coalesce(p_actor_name, '')
    );
    total_value := total_value + line.quantity;
    line_count := line_count + 1;
  end loop;

  update public.inventory_documents
    set status = 'posted', posted_by = p_actor_id, posted_at = now(), updated_at = now()
    where id = doc.id;

  return jsonb_build_object('document_id', doc.id, 'doc_no', doc.doc_no, 'line_count', line_count, 'total_quantity', total_value);
end;
$$;
revoke execute on function public.post_inventory_document(uuid, uuid, text) from public;
revoke execute on function public.post_inventory_document(uuid, uuid, text) from anon;
revoke execute on function public.post_inventory_document(uuid, uuid, text) from authenticated;
grant execute on function public.post_inventory_document(uuid, uuid, text) to service_role;
