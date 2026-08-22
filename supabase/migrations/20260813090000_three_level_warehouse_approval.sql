alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'inv_manager', 'warehouse_keeper', 'staff'));
alter table public.inventory_documents
  add column if not exists warehouse_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists warehouse_reviewed_at timestamptz,
  add column if not exists warehouse_review_note text not null default '';
alter table public.inventory_documents drop constraint if exists inventory_documents_status_check;
alter table public.inventory_documents add constraint inventory_documents_status_check
  check (status in ('draft','pending','warehouse_approved','approved','posted','rejected','cancelled','voided'));
create or replace function public.enforce_inventory_document_status_flow() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    if new.status in ('warehouse_approved','approved','posted') then new.status:='draft'; new.submitted_by:=null; new.approved_by:=null; new.posted_by:=null; new.warehouse_reviewed_by:=null; new.submitted_at:=null; new.approved_at:=null; new.posted_at:=null; new.warehouse_reviewed_at:=null; end if;
    return new;
  end if;
  if new.status=old.status then return new; end if;
  if old.status='draft' and new.status not in ('pending','cancelled') then raise exception '草稿必须先由员工提交';
  elsif old.status='pending' and new.status not in ('warehouse_approved','rejected','cancelled') then raise exception '待审核单据必须先由仓管复核';
  elsif old.status='warehouse_approved' and new.status not in ('approved','rejected','cancelled','draft') then raise exception '仓管复核后必须由管理员终审';
  elsif old.status='approved' and new.status not in ('posted','cancelled','draft') then raise exception '管理员终审通过后只能入账、退回或取消';
  elsif old.status='posted' and new.status<>'voided' then raise exception '已入账单据只能红冲作废';
  elsif old.status in ('voided','cancelled') then raise exception '已作废或已取消单据不能变更状态'; end if;
  return new;
end; $$;
drop trigger if exists enforce_inventory_document_status_flow_trigger on public.inventory_documents;
create trigger enforce_inventory_document_status_flow_trigger before insert or update of status on public.inventory_documents for each row execute function public.enforce_inventory_document_status_flow();
