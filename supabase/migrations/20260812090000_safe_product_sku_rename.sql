-- Safely rename a SKU across legacy inventory records and the V2 trace chain.
create or replace function public.rename_inventory_sku(p_old_sku text, p_new_sku text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text := btrim(coalesce(p_old_sku, ''));
  v_new text := btrim(coalesce(p_new_sku, ''));
begin
  if v_old = '' or v_new = '' then raise exception 'SKU 不能为空'; end if;
  if v_old = v_new then return; end if;

  perform 1 from public.inventory_products where sku = v_old for update;
  if not found then raise exception '原 SKU 不存在：%', v_old; end if;
  if exists(select 1 from public.inventory_products where sku = v_new)
     or exists(select 1 from public.v2_product_main where sku_code = v_new) then
    raise exception '新 SKU 已存在：%', v_new;
  end if;

  update public.v2_product_main set sku_code = v_new, updated_at = now() where sku_code = v_old;
  update public.inventory_products set sku = v_new, updated_at = now() where sku = v_old;
  update public.inventory_document_lines set sku = v_new where sku = v_old;
  update public.inventory_movements set sku = v_new where sku = v_old;
  update public.inventory_activity set sku = v_new where sku = v_old;
end;
$$;
revoke all on function public.rename_inventory_sku(text, text) from public, anon, authenticated;
grant execute on function public.rename_inventory_sku(text, text) to service_role;
