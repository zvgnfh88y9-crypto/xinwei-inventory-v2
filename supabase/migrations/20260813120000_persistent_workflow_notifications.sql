create table if not exists public.workflow_approval_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  document_id uuid not null references public.inventory_documents(id) on delete cascade,
  action text not null check (action in (
    'created','submitted','warehouse_approved','warehouse_rejected',
    'final_approved','final_rejected','returned_to_draft','revision_started',
    'posted','voided','cancelled'
  )),
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  actor_name text,
  comment text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists workflow_approval_events_document_idx
  on public.workflow_approval_events(document_id, created_at asc);

create table if not exists public.workflow_notifications (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.inventory_documents(id) on delete cascade,
  event_type text not null,
  title text not null,
  message text not null,
  route text not null default '/approval',
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workflow_notifications_recipient_idx
  on public.workflow_notifications(recipient_id, is_read, created_at desc);

alter table public.workflow_approval_events enable row level security;
alter table public.workflow_notifications enable row level security;

revoke all on table public.workflow_approval_events from public, anon, authenticated;
revoke all on table public.workflow_notifications from public, anon, authenticated;
grant select on table public.workflow_notifications to authenticated;
grant update (is_read, read_at) on table public.workflow_notifications to authenticated;

drop policy if exists "Authenticated users can read approval events" on public.workflow_approval_events;

drop policy if exists "Users can read their workflow notifications" on public.workflow_notifications;
create policy "Users can read their workflow notifications"
  on public.workflow_notifications for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists "Users can mark their workflow notifications" on public.workflow_notifications;
create policy "Users can mark their workflow notifications"
  on public.workflow_notifications for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Realtime is an accelerator only; the UI also polls so notifications remain
-- available if the publication is temporarily unavailable.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_notifications'
    ) then
    alter publication supabase_realtime add table public.workflow_notifications;
  end if;
end;
$$;

create or replace function public.record_inventory_document_workflow_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_actor_id uuid;
  v_actor_role text;
  v_actor_name text;
  v_comment text := '';
  v_event_id uuid := gen_random_uuid();
  v_route text;
  v_title text;
  v_message text;
  v_recipient uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
    v_actor_id := new.created_by;
  elsif new.status is not distinct from old.status then
    return new;
  elsif new.status = 'pending' then
    v_action := 'submitted';
    v_actor_id := new.submitted_by;
  elsif old.status = 'pending' and new.status = 'warehouse_approved' then
    v_action := 'warehouse_approved';
    v_actor_id := new.warehouse_reviewed_by;
    v_comment := coalesce(new.warehouse_review_note, '');
  elsif old.status = 'pending' and new.status = 'rejected' then
    v_action := 'warehouse_rejected';
    v_actor_id := new.rejected_by;
    v_comment := coalesce(new.rejection_reason, '');
  elsif old.status = 'warehouse_approved' and new.status = 'approved' then
    v_action := 'final_approved';
    v_actor_id := new.approved_by;
  elsif old.status = 'warehouse_approved' and new.status = 'rejected' then
    v_action := 'final_rejected';
    v_actor_id := new.rejected_by;
    v_comment := coalesce(new.rejection_reason, '');
  elsif old.status = 'approved' and new.status = 'draft' then
    v_action := 'returned_to_draft';
    v_actor_id := coalesce(new.rejected_by, old.rejected_by, old.approved_by);
    v_comment := coalesce(new.rejection_reason, '管理员退回修改');
  elsif old.status = 'rejected' and new.status = 'draft' then
    v_action := 'revision_started';
    v_actor_id := new.created_by;
  elsif new.status = 'posted' then
    v_action := 'posted';
    v_actor_id := new.posted_by;
  elsif new.status = 'voided' then
    v_action := 'voided';
    v_actor_id := coalesce(new.voided_by, new.posted_by, new.approved_by);
    v_comment := coalesce(new.rejection_reason, '');
  elsif new.status = 'cancelled' then
    v_action := 'cancelled';
    v_actor_id := coalesce(new.approved_by, new.warehouse_reviewed_by, new.submitted_by, new.created_by);
  else
    return new;
  end if;

  select role, coalesce(display_name, '') into v_actor_role, v_actor_name
    from public.profiles where id = v_actor_id;

  insert into public.workflow_approval_events (
    id, event_key, document_id, action, from_status, to_status,
    actor_id, actor_role, actor_name, comment, created_at
  ) values (
    v_event_id, 'event:' || v_event_id::text, new.id, v_action,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status, v_actor_id, v_actor_role, nullif(v_actor_name, ''), v_comment, now()
  );

  v_route := case
    when new.document_type in ('receipt', 'production_in') then '/inbound'
    when new.document_type in ('shipment', 'retail_sale') then '/outbound'
    else '/approval'
  end;

  if v_action = 'submitted' then
    v_title := '收到待仓管复核单据';
    v_message := new.doc_no || ' 已提交，请核对产品、规格和数量。';
    for v_recipient in
      select id from public.profiles
       where role in ('warehouse_keeper', 'inv_manager') and not coalesce(is_disabled, false)
         and id <> coalesce(v_actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
    loop
      insert into public.workflow_notifications(event_key, recipient_id, document_id, event_type, title, message, route)
      values ('notify:' || v_event_id::text || ':' || v_recipient::text, v_recipient, new.id, v_action, v_title, v_message, '/approval')
      on conflict (event_key) do nothing;
    end loop;
  elsif v_action = 'warehouse_approved' then
    v_title := '仓管复核通过，等待管理员终审';
    v_message := new.doc_no || ' 已完成专业复核。';
    for v_recipient in
      select id from public.profiles where role = 'admin' and not coalesce(is_disabled, false)
    loop
      insert into public.workflow_notifications(event_key, recipient_id, document_id, event_type, title, message, route)
      values ('notify:' || v_event_id::text || ':' || v_recipient::text, v_recipient, new.id, v_action, v_title, v_message, '/approval')
      on conflict (event_key) do nothing;
    end loop;
    if new.created_by is not null and new.created_by <> coalesce(v_actor_id, new.created_by) then
      insert into public.workflow_notifications(event_key, recipient_id, document_id, event_type, title, message, route)
      values ('notify:' || v_event_id::text || ':' || new.created_by::text, new.created_by, new.id, v_action, v_title, v_message, v_route)
      on conflict (event_key) do nothing;
    end if;
  elsif v_action in ('warehouse_rejected', 'final_rejected') then
    v_title := case when v_action = 'warehouse_rejected' then '仓管复核驳回' else '管理员终审驳回' end;
    v_message := new.doc_no || '：' || coalesce(nullif(v_comment, ''), '请查看单据并修改后重新提交。');
    if new.created_by is not null then
      insert into public.workflow_notifications(event_key, recipient_id, document_id, event_type, title, message, route)
      values ('notify:' || v_event_id::text || ':' || new.created_by::text, new.created_by, new.id, v_action, v_title, v_message, v_route)
      on conflict (event_key) do nothing;
    end if;
    if v_action = 'final_rejected' and new.warehouse_reviewed_by is not null and new.warehouse_reviewed_by <> new.created_by then
      insert into public.workflow_notifications(event_key, recipient_id, document_id, event_type, title, message, route)
      values ('notify:' || v_event_id::text || ':' || new.warehouse_reviewed_by::text, new.warehouse_reviewed_by, new.id, v_action, v_title, v_message, '/approval')
      on conflict (event_key) do nothing;
    end if;
  elsif v_action = 'final_approved' then
    v_title := '管理员最终批准';
    v_message := new.doc_no || case
      when new.document_type in ('shipment', 'retail_sale') then ' 已终审通过，等待管理员确认出库。'
      else ' 已终审通过，等待管理员确认入库。'
    end;
    for v_recipient in
      select distinct recipient_id from (
        select id as recipient_id from public.profiles where role = 'admin' and not coalesce(is_disabled, false)
        union all select new.created_by
        union all select new.warehouse_reviewed_by
      ) recipients where recipient_id is not null
    loop
      insert into public.workflow_notifications(event_key, recipient_id, document_id, event_type, title, message, route)
      values ('notify:' || v_event_id::text || ':' || v_recipient::text, v_recipient, new.id, v_action, v_title, v_message,
        case when exists(select 1 from public.profiles where id = v_recipient and role = 'admin') then '/approval' else v_route end)
      on conflict (event_key) do nothing;
    end loop;
  elsif v_action = 'revision_started' then
    v_title := '申请人已开始修改';
    v_message := new.doc_no || ' 正在根据驳回意见修改，修改后会重新提交仓管复核。';
    if old.rejected_by is not null and old.rejected_by <> new.created_by then
      insert into public.workflow_notifications(event_key, recipient_id, document_id, event_type, title, message, route)
      values ('notify:' || v_event_id::text || ':' || old.rejected_by::text, old.rejected_by, new.id, v_action, v_title, v_message, '/approval')
      on conflict (event_key) do nothing;
    end if;
  elsif v_action in ('posted', 'voided', 'returned_to_draft') then
    v_title := case
      when v_action = 'posted' and new.document_type in ('shipment', 'retail_sale') then '单据已确认出库'
      when v_action = 'posted' then '单据已确认入库'
      when v_action = 'voided' then '单据已红冲作废'
      else '管理员退回修改'
    end;
    v_message := new.doc_no || case
      when v_action = 'posted' and new.document_type in ('shipment', 'retail_sale') then ' 已扣减并同步库存。'
      when v_action = 'posted' then ' 已增加并同步库存。'
      when v_action = 'voided' then ' 已红冲，库存已生成反向流水。'
      else ' 已退回草稿，请修改后重新提交。'
    end;
    if new.created_by is not null then
      insert into public.workflow_notifications(event_key, recipient_id, document_id, event_type, title, message, route)
      values ('notify:' || v_event_id::text || ':' || new.created_by::text, new.created_by, new.id, v_action, v_title, v_message, v_route)
      on conflict (event_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists record_inventory_document_workflow_event_trigger on public.inventory_documents;
create trigger record_inventory_document_workflow_event_trigger
after insert or update of status on public.inventory_documents
for each row execute function public.record_inventory_document_workflow_event();

revoke all on function public.record_inventory_document_workflow_event() from public, anon, authenticated;
grant execute on function public.record_inventory_document_workflow_event() to service_role;

-- Backfill a minimal, immutable timeline for existing documents.
insert into public.workflow_approval_events(event_key, document_id, action, from_status, to_status, actor_id, actor_role, actor_name, comment, created_at)
select 'backfill:created:' || d.id::text, d.id, 'created', null, 'draft', d.created_by, p.role, p.display_name, '', d.created_at
from public.inventory_documents d left join public.profiles p on p.id = d.created_by
on conflict (event_key) do nothing;

insert into public.workflow_approval_events(event_key, document_id, action, from_status, to_status, actor_id, actor_role, actor_name, comment, created_at)
select 'backfill:submitted:' || d.id::text, d.id, 'submitted', 'draft', 'pending', d.submitted_by, p.role, p.display_name, '', d.submitted_at
from public.inventory_documents d left join public.profiles p on p.id = d.submitted_by
where d.submitted_at is not null
on conflict (event_key) do nothing;

insert into public.workflow_approval_events(event_key, document_id, action, from_status, to_status, actor_id, actor_role, actor_name, comment, created_at)
select 'backfill:warehouse:' || d.id::text, d.id, 'warehouse_approved', 'pending', 'warehouse_approved', d.warehouse_reviewed_by, p.role, p.display_name, d.warehouse_review_note, d.warehouse_reviewed_at
from public.inventory_documents d left join public.profiles p on p.id = d.warehouse_reviewed_by
where d.warehouse_reviewed_at is not null
on conflict (event_key) do nothing;

insert into public.workflow_approval_events(event_key, document_id, action, from_status, to_status, actor_id, actor_role, actor_name, comment, created_at)
select 'backfill:approved:' || d.id::text, d.id, 'final_approved', 'warehouse_approved', 'approved', d.approved_by, p.role, p.display_name, '', d.approved_at
from public.inventory_documents d left join public.profiles p on p.id = d.approved_by
where d.approved_at is not null
on conflict (event_key) do nothing;

insert into public.workflow_approval_events(event_key, document_id, action, from_status, to_status, actor_id, actor_role, actor_name, comment, created_at)
select 'backfill:posted:' || d.id::text, d.id, 'posted', 'approved', 'posted', d.posted_by, p.role, p.display_name, '', d.posted_at
from public.inventory_documents d left join public.profiles p on p.id = d.posted_by
where d.posted_at is not null
on conflict (event_key) do nothing;
