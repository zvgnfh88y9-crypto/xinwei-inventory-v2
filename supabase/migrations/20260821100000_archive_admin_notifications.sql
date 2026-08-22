create or replace function public.notify_admins_of_shared_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid;
  kind_name text;
begin
  kind_name := case new.document_kind
    when 'delivery_note' then '送货单'
    when 'outbound_note' then '出库单'
    else '收货单'
  end;

  for admin_id in
    select id from public.profiles
    where role = 'admin' and not coalesce(is_disabled, false)
  loop
    insert into public.workflow_notifications (
      event_key, recipient_id, document_id, event_type, title, message, route
    ) values (
      'archive-upload:' || new.id::text || ':' || admin_id::text,
      admin_id,
      null,
      'archive_uploaded',
      '收到新的' || kind_name || '照片',
      coalesce(nullif(new.uploaded_by_name, ''), '快速上传员') || ' 上传了「' || new.original_file_name || '」，单据日期 ' || new.document_date::text || '。',
      '/approval'
    ) on conflict (event_key) do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists shared_document_archive_notify_admins on public.shared_document_archive;
create trigger shared_document_archive_notify_admins
after insert on public.shared_document_archive
for each row execute function public.notify_admins_of_shared_document();

-- 为此次功能上线前已经上传、但尚未提醒的资料补发管理员通知。
insert into public.workflow_notifications (
  event_key, recipient_id, document_id, event_type, title, message, route
)
select
  'archive-upload:' || archive.id::text || ':' || admin_profile.id::text,
  admin_profile.id,
  null,
  'archive_uploaded',
  '收到新的' || case archive.document_kind when 'delivery_note' then '送货单' when 'outbound_note' then '出库单' else '收货单' end || '照片',
  coalesce(nullif(archive.uploaded_by_name, ''), '快速上传员') || ' 上传了「' || archive.original_file_name || '」，单据日期 ' || archive.document_date::text || '。',
  '/approval'
from public.shared_document_archive archive
cross join public.profiles admin_profile
where archive.status = 'uploaded'
  and admin_profile.role = 'admin'
  and not coalesce(admin_profile.is_disabled, false)
on conflict (event_key) do nothing;
