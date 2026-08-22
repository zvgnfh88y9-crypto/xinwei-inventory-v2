alter table public.inventory_documents
  add column if not exists delivery_no text not null default '',
  add column if not exists contact_name text not null default '',
  add column if not exists contact_phone text not null default '',
  add column if not exists partner_address text not null default '';
alter table public.inventory_document_lines
  add column if not exists specification text not null default '',
  add column if not exists color text not null default '',
  add column if not exists line_remark text not null default '';
