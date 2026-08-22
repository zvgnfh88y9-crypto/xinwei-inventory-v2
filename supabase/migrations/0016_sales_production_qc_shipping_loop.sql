-- Stage 2: Sales -> allocation -> production -> QC -> shipment closed loop.
-- This migration is intentionally additive and keeps the Stage 1 legacy/V2 bridge intact.

-- 1) Sales-line allocation state ----------------------------------------------
alter table public.v2_sales_order_lines
  add column if not exists locked_qty numeric(14,3) not null default 0,
  add column if not exists updated_at timestamptz not null default now();
alter table public.v2_sales_order_lines drop constraint if exists v2_sales_order_lines_locked_qty_check;
alter table public.v2_sales_order_lines
  add constraint v2_sales_order_lines_locked_qty_check check (locked_qty >= 0);
alter table public.v2_sales_orders drop constraint if exists v2_sales_orders_status_check;
alter table public.v2_sales_orders
  add constraint v2_sales_orders_status_check
  check (status in ('draft','confirmed','in_production','ready_to_ship','partially_shipped','completed','cancelled'));
-- Production orders can point at the exact sales line that caused the shortage.
alter table public.v2_production_orders
  add column if not exists sales_order_line_id uuid references public.v2_sales_order_lines(id) on delete set null;
create index if not exists v2_production_orders_sales_line_idx
  on public.v2_production_orders(sales_order_line_id, status);
-- 2) Shipment documents --------------------------------------------------------
create table if not exists public.v2_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_no text not null unique,
  sales_order_id uuid not null references public.v2_sales_orders(id) on delete restrict,
  warehouse text not null default '主仓库',
  status text not null default 'shipped' check (status in ('draft','shipped','delivered','cancelled')),
  carrier text not null default '',
  tracking_no text not null default '',
  shipped_by uuid references auth.users(id) on delete set null,
  shipped_at timestamptz,
  delivered_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v2_shipments_order_idx on public.v2_shipments(sales_order_id, created_at desc);
create table if not exists public.v2_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.v2_shipments(id) on delete cascade,
  sales_order_line_id uuid not null references public.v2_sales_order_lines(id) on delete restrict,
  sku_code text not null references public.v2_product_main(sku_code) on update cascade on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default '件',
  created_at timestamptz not null default now()
);
create index if not exists v2_shipment_lines_shipment_idx on public.v2_shipment_lines(shipment_id);
alter table public.v2_shipments enable row level security;
alter table public.v2_shipment_lines enable row level security;
revoke all on table public.v2_shipments from anon, authenticated;
revoke all on table public.v2_shipment_lines from anon, authenticated;
-- Stage 1 locked balances had no sales-order ownership marker. Refuse to guess
-- ownership if such balances exist; they must be reconciled before Stage 2.
do $$
begin
  if exists (
    select 1 from public.v2_inventory_balances
    where status = 'locked' and quantity > 0 and coalesce(batch_no,'') = ''
  ) then
    raise exception '检测到第一阶段遗留的无订单归属锁定库存。请先解除/核对这些 locked 余额，再执行 0016，系统不会自动猜测归属。';
  end if;
end $$;
-- 3) Sales-order status refresh ------------------------------------------------
create or replace function public.v2_refresh_sales_order_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.v2_sales_orders%rowtype;
  v_total numeric := 0;
  v_shipped numeric := 0;
  v_locked numeric := 0;
  v_active_production integer := 0;
  v_status text;
begin
  select * into v_order from public.v2_sales_orders where id = p_order_id for update;
  if not found then raise exception '销售订单不存在'; end if;
  if v_order.status = 'cancelled' then return v_order.status; end if;

  select coalesce(sum(quantity),0), coalesce(sum(shipped_qty),0), coalesce(sum(locked_qty),0)
  into v_total, v_shipped, v_locked
  from public.v2_sales_order_lines
  where order_id = p_order_id;

  select count(*) into v_active_production
  from public.v2_production_orders
  where sales_order_id = p_order_id
    and status in ('draft','in_progress');

  if v_total > 0 and v_shipped >= v_total then
    v_status := 'completed';
  elsif v_shipped > 0 then
    v_status := 'partially_shipped';
  elsif v_total > 0 and v_locked >= v_total then
    v_status := 'ready_to_ship';
  elsif v_active_production > 0 then
    v_status := 'in_production';
  else
    v_status := 'confirmed';
  end if;

  update public.v2_sales_orders
  set status = v_status, updated_at = now()
  where id = p_order_id;
  return v_status;
end;
$$;
-- 4) Idempotent partial allocation --------------------------------------------
create or replace function public.v2_lock_inventory(p_plan_id uuid, p_warehouse text default '主仓库')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.v2_sales_orders%rowtype;
  v_line public.v2_sales_order_lines%rowtype;
  v_need numeric;
  v_available numeric;
  v_take numeric;
  v_locked_total numeric := 0;
  v_shortages jsonb := '[]'::jsonb;
  v_status text;
begin
  select * into v_order from public.v2_sales_orders where id = p_plan_id for update;
  if not found then raise exception '销售订单不存在'; end if;
  if v_order.status in ('cancelled','completed') then
    raise exception '订单状态 % 不允许再次锁库', v_order.status;
  end if;

  for v_line in
    select * from public.v2_sales_order_lines where order_id = p_plan_id order by created_at for update
  loop
    v_need := greatest(v_line.quantity - v_line.shipped_qty - v_line.locked_qty, 0);
    if v_need <= 0 then continue; end if;

    select coalesce(sum(quantity),0) into v_available
    from public.v2_inventory_balances
    where sku_code = v_line.sku_code
      and warehouse = coalesce(nullif(p_warehouse,''),'主仓库')
      and status = 'available';

    v_take := least(v_need, v_available);
    if v_take > 0 then
      perform public.v2_consume_balance(v_line.sku_code, p_warehouse, 'available', v_take, '');
      -- locked inventory is owned by this sales order via batch_no=order UUID.
      perform public.v2_add_balance(v_line.sku_code, p_warehouse, 'locked', v_take, p_plan_id::text, '');
      update public.v2_sales_order_lines
      set locked_qty = locked_qty + v_take, updated_at = now()
      where id = v_line.id;
      v_locked_total := v_locked_total + v_take;
    end if;

    if v_need - v_take > 0 then
      v_shortages := v_shortages || jsonb_build_array(jsonb_build_object(
        'line_id', v_line.id,
        'sku_code', v_line.sku_code,
        'shortage_qty', v_need - v_take
      ));
    end if;
  end loop;

  v_status := public.v2_refresh_sales_order_status(p_plan_id);
  return jsonb_build_object(
    'locked_qty', v_locked_total,
    'shortages', v_shortages,
    'status', v_status
  );
end;
$$;
-- 4b) Production completion must not over-report the work order ------------------
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

  v_new_total := v_order.actual_qty + v_order.scrap_qty + p_pass_qty + p_fail_qty;
  if v_new_total > v_order.plan_qty then
    raise exception '本次报工后数量 % 超过计划数量 %', v_new_total, v_order.plan_qty;
  end if;

  select coalesce(base_unit, '件') into v_unit from public.v2_product_main where sku_code = v_order.sku_code;

  if p_pass_qty > 0 then
    perform public.v2_add_balance(v_order.sku_code, p_warehouse, 'inspecting', p_pass_qty, p_production_id::text, '');
    v_receipt_no := 'PR-' || regexp_replace(v_order.order_no, '[^A-Za-z0-9_-]', '', 'g') || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    insert into public.v2_warehouse_receipts(receipt_no, status, received_by, notes)
    values (v_receipt_no, 'received', p_actor_id, '生产完工自动生成，工单：' || v_order.order_no)
    returning id into v_receipt_id;
    insert into public.v2_warehouse_receipt_lines(receipt_id, sku_code, received_qty, unit, batch_no, warehouse)
    values (v_receipt_id, v_order.sku_code, p_pass_qty, v_unit, p_production_id::text, p_warehouse);
  end if;

  if p_fail_qty > 0 then
    perform public.v2_add_balance(v_order.sku_code, p_warehouse, 'defective', p_fail_qty, p_production_id::text, '');
  end if;

  update public.v2_production_orders
  set actual_qty = actual_qty + p_pass_qty,
      scrap_qty = scrap_qty + p_fail_qty,
      status = case when v_new_total >= plan_qty then 'completed' else 'in_progress' end,
      completed_at = case when v_new_total >= plan_qty then now() else completed_at end,
      updated_at = now()
  where id = p_production_id;

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
-- 5) QC finalization with sales-order auto allocation --------------------------
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
  v_line_warehouse text;
  v_production_id uuid;
  v_sales_line public.v2_sales_order_lines%rowtype;
  v_allocate numeric;
  v_need numeric;
  v_auto_locked numeric := 0;
  v_receipt_status text;
begin
  select * into v_inspection from public.v2_quality_inspections where id = p_inspect_id for update;
  if not found then raise exception '质检单不存在'; end if;
  if v_inspection.status <> 'draft' then raise exception '该质检单状态不允许入账：%', v_inspection.status; end if;

  select status into v_receipt_status from public.v2_warehouse_receipts where id = v_inspection.receipt_id for update;
  if not found then raise exception '关联收货单不存在'; end if;
  if v_receipt_status <> 'received' then raise exception '收货单状态为 %，不能重复质检', v_receipt_status; end if;

  for v_line in
    select q.*, r.received_qty, r.batch_no, r.warehouse
    from public.v2_quality_inspection_lines q
    left join public.v2_warehouse_receipt_lines r on r.id = q.receipt_line_id
    where q.inspect_id = p_inspect_id
  loop
    v_received := coalesce(v_line.received_qty, v_line.pass_qty + v_line.fail_qty);
    v_line_warehouse := coalesce(nullif(v_line.warehouse,''), nullif(p_warehouse,''), '主仓库');

    if v_line.pass_qty < 0 or v_line.fail_qty < 0 then
      raise exception 'SKU % 的质检数量不能为负数', v_line.sku_code;
    end if;
    if v_line.pass_qty + v_line.fail_qty <> v_received then
      raise exception 'SKU % 的合格+不良数量必须等于收货数量 %', v_line.sku_code, v_received;
    end if;

    select coalesce(sum(quantity),0) into v_inspecting
    from public.v2_inventory_balances
    where sku_code = v_line.sku_code
      and warehouse = v_line_warehouse
      and status = 'inspecting'
      and (coalesce(v_line.batch_no,'') = '' or batch_no = coalesce(v_line.batch_no,''));

    if v_inspecting < v_received then
      raise exception 'SKU % 待检库存不足：需要 %，当前 %。已阻止重复/越权入库。', v_line.sku_code, v_received, v_inspecting;
    end if;

    perform public.v2_consume_balance(v_line.sku_code, v_line_warehouse, 'inspecting', v_received, coalesce(v_line.batch_no,''));
    perform public.v2_add_balance(v_line.sku_code, v_line_warehouse, 'available', v_line.pass_qty, coalesce(v_line.batch_no,''), '');
    perform public.v2_add_balance(v_line.sku_code, v_line_warehouse, 'defective', v_line.fail_qty, coalesce(v_line.batch_no,''), '');

    -- Production receipts use production UUID as batch_no. If the work order came
    -- from a sales line, newly-qualified stock is automatically reserved for it.
    v_production_id := null;
    begin
      v_production_id := nullif(coalesce(v_line.batch_no,''),'')::uuid;
    exception when invalid_text_representation then
      v_production_id := null;
    end;

    if v_production_id is not null and v_line.pass_qty > 0 then
      select sol.* into v_sales_line
      from public.v2_production_orders po
      join public.v2_sales_order_lines sol on sol.id = po.sales_order_line_id
      where po.id = v_production_id
      for update of sol;

      if found then
        v_need := greatest(v_sales_line.quantity - v_sales_line.shipped_qty - v_sales_line.locked_qty, 0);
        v_allocate := least(v_line.pass_qty, v_need);
        if v_allocate > 0 then
          perform public.v2_consume_balance(v_line.sku_code, v_line_warehouse, 'available', v_allocate, coalesce(v_line.batch_no,''));
          perform public.v2_add_balance(v_line.sku_code, v_line_warehouse, 'locked', v_allocate, v_sales_line.order_id::text, '');
          update public.v2_sales_order_lines
          set locked_qty = locked_qty + v_allocate, updated_at = now()
          where id = v_sales_line.id;
          v_auto_locked := v_auto_locked + v_allocate;
        end if;
        -- Also refresh when all QC output failed or the order no longer needs this stock.
        perform public.v2_refresh_sales_order_status(v_sales_line.order_id);
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  update public.v2_quality_inspections set status = 'completed', updated_at = now() where id = p_inspect_id;
  update public.v2_warehouse_receipts set status = 'inspected', updated_at = now() where id = v_inspection.receipt_id;
  return jsonb_build_object('inspected_lines', v_count, 'auto_locked_qty', v_auto_locked);
end;
$$;
-- 6) Shipment posting ----------------------------------------------------------
create or replace function public.v2_ship_sales_order(
  p_order_id uuid,
  p_warehouse text default '主仓库',
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.v2_sales_orders%rowtype;
  v_line public.v2_sales_order_lines%rowtype;
  v_shipment_id uuid;
  v_shipment_no text;
  v_total numeric := 0;
  v_status text;
begin
  select * into v_order from public.v2_sales_orders where id = p_order_id for update;
  if not found then raise exception '销售订单不存在'; end if;
  if v_order.status in ('cancelled','completed') then
    raise exception '订单状态 % 不允许出库', v_order.status;
  end if;

  if not exists (
    select 1 from public.v2_sales_order_lines where order_id = p_order_id and locked_qty > 0
  ) then
    raise exception '当前订单没有已锁定库存可出库';
  end if;

  v_shipment_no := 'SHP-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  insert into public.v2_shipments(shipment_no, sales_order_id, warehouse, status, shipped_by, shipped_at)
  values (v_shipment_no, p_order_id, coalesce(nullif(p_warehouse,''),'主仓库'), 'shipped', p_actor_id, now())
  returning id into v_shipment_id;

  for v_line in
    select * from public.v2_sales_order_lines where order_id = p_order_id and locked_qty > 0 order by created_at for update
  loop
    perform public.v2_consume_balance(v_line.sku_code, p_warehouse, 'locked', v_line.locked_qty, p_order_id::text);
    -- Out of warehouse but not yet customer-confirmed: keep it in shipped status.
    perform public.v2_add_balance(v_line.sku_code, p_warehouse, 'shipped', v_line.locked_qty, v_shipment_id::text, '');

    insert into public.v2_shipment_lines(shipment_id, sales_order_line_id, sku_code, quantity, unit)
    values (v_shipment_id, v_line.id, v_line.sku_code, v_line.locked_qty, v_line.unit);

    v_total := v_total + v_line.locked_qty;
    update public.v2_sales_order_lines
    set shipped_qty = shipped_qty + locked_qty,
        locked_qty = 0,
        updated_at = now()
    where id = v_line.id;
  end loop;

  v_status := public.v2_refresh_sales_order_status(p_order_id);
  return jsonb_build_object(
    'shipment_id', v_shipment_id,
    'shipment_no', v_shipment_no,
    'shipped_qty', v_total,
    'order_status', v_status
  );
end;
$$;
create or replace function public.v2_confirm_shipment_delivery(
  p_shipment_id uuid,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.v2_shipments%rowtype;
  v_line public.v2_shipment_lines%rowtype;
  v_total numeric := 0;
begin
  select * into v_shipment from public.v2_shipments where id = p_shipment_id for update;
  if not found then raise exception '出货单不存在'; end if;
  if v_shipment.status = 'delivered' then raise exception '该出货单已经确认签收'; end if;
  if v_shipment.status <> 'shipped' then raise exception '只有已发货状态可以确认签收'; end if;

  for v_line in select * from public.v2_shipment_lines where shipment_id = p_shipment_id order by created_at loop
    perform public.v2_consume_balance(v_line.sku_code, v_shipment.warehouse, 'shipped', v_line.quantity, p_shipment_id::text);
    v_total := v_total + v_line.quantity;
  end loop;

  update public.v2_shipments
  set status = 'delivered', delivered_at = now(), updated_at = now()
  where id = p_shipment_id;

  return jsonb_build_object('delivered_qty', v_total, 'shipment_id', p_shipment_id);
end;
$$;
-- 7) Function permissions ------------------------------------------------------
revoke execute on function public.v2_refresh_sales_order_status(uuid) from public, anon, authenticated;
revoke execute on function public.v2_lock_inventory(uuid,text) from public, anon, authenticated;
revoke execute on function public.v2_complete_production(uuid,numeric,numeric,text,uuid) from public, anon, authenticated;
revoke execute on function public.v2_finalize_inspection(uuid,text,uuid) from public, anon, authenticated;
revoke execute on function public.v2_ship_sales_order(uuid,text,uuid) from public, anon, authenticated;
revoke execute on function public.v2_confirm_shipment_delivery(uuid,uuid) from public, anon, authenticated;
grant execute on function public.v2_refresh_sales_order_status(uuid) to service_role;
grant execute on function public.v2_lock_inventory(uuid,text) to service_role;
grant execute on function public.v2_complete_production(uuid,numeric,numeric,text,uuid) to service_role;
grant execute on function public.v2_finalize_inspection(uuid,text,uuid) to service_role;
grant execute on function public.v2_ship_sales_order(uuid,text,uuid) to service_role;
grant execute on function public.v2_confirm_shipment_delivery(uuid,uuid) to service_role;
