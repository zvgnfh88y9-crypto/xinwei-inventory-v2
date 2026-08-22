-- Administrators are the final authority. When an administrator creates a
-- draft personally, allow a single audited action to complete all approval
-- stages while still keeping inventory posting as a separate explicit step.

create or replace function public.admin_approve_own_inventory_draft(
  p_document_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.inventory_documents%rowtype;
  v_role text;
  v_now timestamptz := now();
begin
  select role into v_role
    from public.profiles
   where id = p_actor_id
     and not coalesce(is_disabled, false);
  if v_role is distinct from 'admin' then
    raise exception '只有管理员可以直接审核自己创建的草稿';
  end if;

  select * into v_doc
    from public.inventory_documents
   where id = p_document_id
   for update;
  if not found then raise exception '单据不存在'; end if;
  if v_doc.status <> 'draft' then raise exception '只有草稿单据可以直接审核'; end if;
  if v_doc.created_by <> p_actor_id then raise exception '管理员只能直接审核自己创建的草稿'; end if;
  if not exists (
    select 1 from public.inventory_document_lines
     where document_id = p_document_id
       and coalesce(trim(sku), '') <> ''
       and quantity > 0
  ) then raise exception '单据至少需要一条有效明细'; end if;
  if exists (
    select 1 from public.inventory_document_lines
     where document_id = p_document_id
       and (coalesce(trim(sku), '') = '' or quantity <= 0)
  ) then raise exception '单据存在无效 SKU 或数量'; end if;

  update public.inventory_documents set
    status = 'pending', submitted_by = p_actor_id, submitted_at = v_now,
    updated_at = v_now
  where id = p_document_id and status = 'draft';

  update public.inventory_documents set
    status = 'warehouse_approved', warehouse_reviewed_by = p_actor_id,
    warehouse_reviewed_at = v_now,
    warehouse_review_note = '管理员本人录入，使用管理员直接审核通道',
    updated_at = v_now
  where id = p_document_id and status = 'pending';

  update public.inventory_documents set
    status = 'approved', approved_by = p_actor_id, approved_at = v_now,
    updated_at = v_now
  where id = p_document_id and status = 'warehouse_approved';

  return jsonb_build_object('ok', true, 'document_id', p_document_id, 'status', 'approved');
end;
$$;

revoke all on function public.admin_approve_own_inventory_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_approve_own_inventory_draft(uuid, uuid) to service_role;
