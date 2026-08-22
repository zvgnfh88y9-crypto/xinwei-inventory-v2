create table if not exists public.shared_document_archive (
  id uuid primary key default gen_random_uuid(),
  document_kind text not null check (document_kind in ('delivery_note', 'receipt_note')),
  document_date date not null default current_date,
  partner_name text not null default '',
  notes text not null default '',
  original_file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  status text not null default 'uploaded' check (status in ('uploaded', 'reviewed', 'archived')),
  uploaded_by uuid not null references auth.users(id),
  uploaded_by_name text not null default '',
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  download_count integer not null default 0 check (download_count >= 0),
  last_downloaded_at timestamptz,
  last_downloaded_by uuid references auth.users(id)
);

create index if not exists shared_document_archive_date_idx
  on public.shared_document_archive(document_date desc, uploaded_at desc);
create index if not exists shared_document_archive_uploader_idx
  on public.shared_document_archive(uploaded_by, uploaded_at desc);
create index if not exists shared_document_archive_status_idx
  on public.shared_document_archive(status, uploaded_at desc);

alter table public.shared_document_archive enable row level security;
revoke all on public.shared_document_archive from anon, authenticated;
grant all on public.shared_document_archive to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_document_archive'
  ) then
    alter publication supabase_realtime add table public.shared_document_archive;
  end if;
end $$;
