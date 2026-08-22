-- Keep draft header and line replacement atomic, and make the database state
-- machine reject empty/invalid documents even if an Edge Function is bypassed.

create or replace function public.update_inventory_document_draft_atomic(
  p_document_id uuid,
  p_actor_id uuid,
  p_document jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.inventory_documents%rowtype;
  v_role text;
  v_line jsonb;
  v_line_count integer := 0;
begin
  if p_document_id is null or p_actor_id is null then
    raise exception '单据编号和操作人不能为空';
  end if;
  if jsonb_typeof(coalesce(p_document, '{}'::jsonb)) <> 'object' then
    raise exception '单据头格式无效';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception '单据明细格式无效';
  end if;

  select role into v_role
    from public.profiles
   where id = p_actor_id
     and not coalesce(is_disabled, false);
  if v_role is null then raise exception '账号无效或已禁用'; end if;

  select * into v_doc
    from public.inventory_documents
   where id = p_document_id
   for update;
  if not found then raise exception '单据不存在'; end if;
  if v_doc.status <> 'draft' then raise exception '只有草稿单据可以修改'; end if;
  if v_role <> 'admin' and v_doc.created_by <> p_actor_id then
    raise exception '只能修改自己创建的草稿单据';
  end if;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    if coalesce(trim(v_line->>'sku'), '') = '' then raise exception '明细 SKU 不能为空'; end if;
    if coalesce(v_line->>'quantity', '') !~ '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$'
      or (v_line->>'quantity')::numeric <= 0 then
      raise exception '明细数量必须大于 0';
    end if;
    if coalesce(v_line->>'unit_price', '') <> '' and (
      (v_line->>'unit_price') !~ '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*$'
      or (v_line->>'unit_price')::numeric < 0
    ) then
      raise exception '明细单价不能为负数';
    end if;
    v_line_count := v_line_count + 1;
  end loop;
  if v_line_count = 0 then raise exception '单据至少需要一条有效明细'; end if;

  update public.inventory_documents set
    business_date = coalesce(nullif(trim(p_document->>'business_date'), '')::date, v_doc.business_date),
    partner_name = coalesce(p_document->>'partner_name', ''),
    order_no = coalesce(p_document->>'order_no', ''),
    notes = coalesce(p_document->>'notes', ''),
    inbound_person = coalesce(p_document->>'inbound_person', ''),
    image_path = coalesce(p_document->>'image_path', ''),
    updated_at = now()
  where id = p_document_id and status = 'draft';

  delete from public.inventory_document_lines where document_id = p_document_id;

  insert into public.inventory_document_lines (
    document_id, sku, product_name, spec, specification, color, line_remark,
    quantity, unit, batch_no, warehouse, unit_price
  )
  select
    p_document_id,
    trim(value->>'sku'),
    coalesce(value->>'product_name', ''),
    coalesce(value->>'spec', ''),
    coalesce(value->>'specification', ''),
    coalesce(value->>'color', ''),
    coalesce(value->>'line_remark', ''),
    (value->>'quantity')::numeric,
    coalesce(nullif(trim(value->>'unit'), ''), '条'),
    coalesce(value->>'batch_no', ''),
    coalesce(value->>'warehouse', ''),
    coalesce(nullif(value->>'unit_price', '')::numeric, 0)
  from jsonb_array_elements(p_lines);

  return jsonb_build_object('ok', true, 'document_id', p_document_id, 'line_count', v_line_count);
end;
$$;

revoke all on function public.update_inventory_document_draft_atomic(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_inventory_document_draft_atomic(uuid, uuid, jsonb, jsonb) to service_role;

create or replace function public.enforce_inventory_document_status_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid_line_count integer;
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then new.status := 'draft'; end if;
    new.submitted_by := null;
    new.submitted_at := null;
    new.warehouse_reviewed_by := null;
    new.warehouse_reviewed_at := null;
    new.warehouse_review_note := '';
    new.approved_by := null;
    new.approved_at := null;
    new.posted_by := null;
    new.posted_at := null;
    new.rejected_by := null;
    new.rejection_reason := '';
    new.voided_by := null;
    new.voided_at := null;
    return new;
  end if;

  if new.status = old.status then return new; end if;

  if (old.status = 'draft' and new.status = 'pending')
    or (old.status = 'approved' and new.status = 'posted') then
    select count(*) into v_valid_line_count
      from public.inventory_document_lines
     where document_id = old.id
       and coalesce(trim(sku), '') <> ''
       and quantity > 0;
    if v_valid_line_count = 0 then
      raise exception '单据至少需要一条有效明细，不能提交或入账';
    end if;
    if exists (
      select 1 from public.inventory_document_lines
       where document_id = old.id
         and (coalesce(trim(sku), '') = '' or quantity <= 0)
    ) then
      raise exception '单据存在无效 SKU 或数量，不能提交或入账';
    end if;
  end if;

  if old.status = 'draft' and new.status not in ('pending', 'cancelled') then
    raise exception '草稿必须先提交仓管复核';
  elsif old.status = 'pending' and new.status not in ('warehouse_approved', 'rejected', 'cancelled') then
    raise exception '待审核单据必须先由仓管复核';
  elsif old.status = 'warehouse_approved' and new.status not in ('approved', 'rejected', 'cancelled', 'draft') then
    raise exception '仓管复核后必须由管理员终审';
  elsif old.status = 'approved' and new.status not in ('posted', 'cancelled', 'draft') then
    raise exception '管理员终审通过后只能执行入账、退回或取消';
  elsif old.status = 'rejected' and new.status <> 'draft' then
    raise exception '已驳回单据只能退回草稿修改';
  elsif old.status = 'posted' and new.status <> 'voided' then
    raise exception '已入账单据只能红冲作废';
  elsif old.status in ('voided', 'cancelled') then
    raise exception '已作废或已取消单据不能变更状态';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_inventory_document_status_flow() from public, anon, authenticated;
grant execute on function public.enforce_inventory_document_status_flow() to service_role;
