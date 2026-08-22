-- Final workflow hardening and canonical red reversal.
-- This migration intentionally comes after the legacy void implementations so
-- the active function never creates a fake posted document or negative line.

create or replace function public.enforce_inventory_document_status_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- External imports may provide business fields, but every new document must
    -- enter through the same employee -> warehouse -> administrator workflow.
    if new.status is distinct from 'draft' then
      new.status := 'draft';
    end if;
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

create or replace function public.void_inventory_document(
  p_document_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.inventory_documents%rowtype;
  v_line public.inventory_document_lines%rowtype;
  v_product public.inventory_products%rowtype;
  v_before numeric;
  v_after numeric;
  v_direction text;
  v_actor_name text := '';
begin
  select * into v_doc
    from public.inventory_documents
   where id = p_document_id
   for update;
  if not found then raise exception '单据不存在'; end if;
  if v_doc.status <> 'posted' then raise exception '只有已入账单据可以红冲作废'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '红冲作废必须填写原因'; end if;

  select coalesce(display_name, '') into v_actor_name
    from public.profiles where id = p_actor_id;

  for v_line in
    select * from public.inventory_document_lines
     where document_id = p_document_id
     order by created_at, id
  loop
    select * into v_product
      from public.inventory_products
     where lower(trim(sku)) = lower(trim(v_line.sku))
     for update;
    if not found then raise exception '产品编号不存在：%', v_line.sku; end if;

    case v_doc.document_type
      when 'receipt', 'production_in' then
        if v_product.stock < v_line.quantity or v_product.available_stock < v_line.quantity then
          raise exception '产品 % 当前库存已被后续业务占用，无法红冲该入库单', v_line.sku;
        end if;
        v_before := v_product.stock;
        v_after := v_product.stock - v_line.quantity;
        v_direction := 'out';
        update public.inventory_products set
          stock = stock - v_line.quantity,
          available_stock = available_stock - v_line.quantity,
          status = case when stock - v_line.quantity <= 0 then 'Out of Stock'
                        when stock - v_line.quantity <= 100 then 'Low Stock'
                        when stock - v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
          updated_by = p_actor_id, updated_at = now()
        where id = v_product.id;

      when 'shipment' then
        v_before := v_product.stock;
        v_after := v_product.stock + v_line.quantity;
        v_direction := 'in';
        update public.inventory_products set
          stock = stock + v_line.quantity,
          available_stock = available_stock + v_line.quantity,
          status = case when stock + v_line.quantity <= 0 then 'Out of Stock'
                        when stock + v_line.quantity <= 100 then 'Low Stock'
                        when stock + v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
          updated_by = p_actor_id, updated_at = now()
        where id = v_product.id;

      when 'transfer_to_retail' then
        if v_product.retail_stock < v_line.quantity then
          raise exception '产品 % 零售仓库存已被后续业务占用，无法红冲调拨单', v_line.sku;
        end if;
        v_before := v_product.stock;
        v_after := v_product.stock + v_line.quantity;
        v_direction := 'in';
        update public.inventory_products set
          stock = stock + v_line.quantity,
          available_stock = available_stock + v_line.quantity,
          retail_stock = retail_stock - v_line.quantity,
          status = case when stock + v_line.quantity <= 0 then 'Out of Stock'
                        when stock + v_line.quantity <= 100 then 'Low Stock'
                        when stock + v_line.quantity >= 500 then 'High Stock' else 'In Stock' end,
          updated_by = p_actor_id, updated_at = now()
        where id = v_product.id;

      when 'retail_sale' then
        v_before := v_product.retail_stock;
        v_after := v_product.retail_stock + v_line.quantity;
        v_direction := 'in';
        update public.inventory_products set
          retail_stock = retail_stock + v_line.quantity,
          updated_by = p_actor_id, updated_at = now()
        where id = v_product.id;

      else
        raise exception '不支持的单据类型：%', v_doc.document_type;
    end case;

    insert into public.inventory_movements (
      document_id, line_id, sku, direction, quantity, before_stock, after_stock,
      business_date, actor_id, actor_name, is_reversal, reason_code, notes
    ) values (
      v_doc.id, v_line.id, v_line.sku, v_direction, v_line.quantity, v_before, v_after,
      current_date, p_actor_id, v_actor_name, true, 'VOID', '红冲：' || trim(p_reason)
    );

    insert into public.inventory_activity (
      product_id, sku, product_name, action, quantity_label, detail, changes, actor_id, actor_name
    ) values (
      v_product.id, v_line.sku, coalesce(nullif(v_line.product_name, ''), v_product.name),
      case when v_direction = 'in' then 'IN' else 'OUT' end,
      case when v_direction = 'in' then '+' else '-' end || v_line.quantity::text,
      '红冲作废 · ' || v_doc.doc_no,
      '余额：' || v_before::text || ' → ' || v_after::text || '；原因：' || trim(p_reason),
      p_actor_id, v_actor_name
    );
  end loop;

  update public.inventory_documents set
    status = 'voided',
    voided_at = now(),
    voided_by = p_actor_id,
    audit_log = coalesce(audit_log, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('action', 'voided', 'at', now(), 'by', p_actor_id, 'reason', trim(p_reason))
    ),
    updated_at = now()
  where id = v_doc.id;

  return jsonb_build_object('success', true, 'document_id', v_doc.id, 'doc_no', v_doc.doc_no);
end;
$$;

revoke all on function public.void_inventory_document(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.void_inventory_document(uuid, uuid, text) to service_role;
