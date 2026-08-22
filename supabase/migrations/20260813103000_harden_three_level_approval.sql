create or replace function public.enforce_inventory_document_status_flow() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    if new.status in ('warehouse_approved','approved','posted') then new.status:='draft'; new.submitted_by:=null; new.approved_by:=null; new.posted_by:=null; new.warehouse_reviewed_by:=null; new.submitted_at:=null; new.approved_at:=null; new.posted_at:=null; new.warehouse_reviewed_at:=null; end if;
    return new;
  end if;
  if new.status=old.status then return new; end if;
  if old.status='draft' and new.status not in ('pending','cancelled') then raise exception '草稿必须先提交仓管复核';
  elsif old.status='pending' and new.status not in ('warehouse_approved','rejected','cancelled') then raise exception '待审核单据必须先由仓管复核';
  elsif old.status='warehouse_approved' and new.status not in ('approved','rejected','cancelled','draft') then raise exception '仓管复核后必须由管理员终审';
  elsif old.status='approved' and new.status not in ('posted','cancelled','draft') then raise exception '管理员终审通过后只能执行入账、退回或取消';
  elsif old.status='rejected' and new.status<>'draft' then raise exception '已驳回单据只能退回草稿修改';
  elsif old.status='posted' and new.status<>'voided' then raise exception '已入账单据只能红冲作废';
  elsif old.status in ('voided','cancelled') then raise exception '已作废或已取消单据不能变更状态'; end if;
  return new;
end; $$;
revoke all on function public.enforce_inventory_document_status_flow() from public, anon, authenticated;
grant execute on function public.enforce_inventory_document_status_flow() to service_role;
