-- Enforce draft -> pending -> approved -> posted even for external importers.
create or replace function public.enforce_inventory_document_status_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Imports may provide business data, but may never create accounting entries directly.
    if new.status in ('approved', 'posted') then
      new.status := 'draft';
      new.submitted_by := null;
      new.approved_by := null;
      new.posted_by := null;
      new.submitted_at := null;
      new.approved_at := null;
      new.posted_at := null;
    end if;
    return new;
  end if;

  if new.status = old.status then return new; end if;
  if old.status = 'draft' and new.status not in ('pending', 'cancelled') then
    raise exception '草稿必须先提交审核';
  elsif old.status = 'pending' and new.status not in ('approved', 'rejected', 'cancelled') then
    raise exception '待审核单据必须先由管理员审核';
  elsif old.status = 'approved' and new.status not in ('posted', 'cancelled') then
    raise exception '已审核单据只能入账或取消';
  elsif old.status = 'posted' and new.status not in ('voided') then
    raise exception '已入账单据只能红冲作废';
  elsif old.status in ('voided', 'cancelled') then
    raise exception '已作废或已取消单据不能变更状态';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_inventory_document_status_flow_trigger on public.inventory_documents;
create trigger enforce_inventory_document_status_flow_trigger
before insert or update of status on public.inventory_documents
for each row execute function public.enforce_inventory_document_status_flow();
revoke all on function public.enforce_inventory_document_status_flow() from public, anon, authenticated;
grant execute on function public.enforce_inventory_document_status_flow() to service_role;
