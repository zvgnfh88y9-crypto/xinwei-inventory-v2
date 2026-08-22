alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'inv_manager', 'warehouse_keeper', 'staff', 'uploader'));

alter table public.shared_document_archive drop constraint if exists shared_document_archive_document_kind_check;
alter table public.shared_document_archive add constraint shared_document_archive_document_kind_check
  check (document_kind in ('delivery_note', 'receipt_note', 'outbound_note'));
