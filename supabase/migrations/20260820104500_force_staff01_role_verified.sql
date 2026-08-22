do $$
declare
  changed_rows integer;
begin
  update public.profiles p
  set role = 'staff', updated_at = clock_timestamp()
  from auth.users u
  where p.id = u.id
    and regexp_replace(lower(coalesce(u.email, '')), '\s+', '', 'g') = 'staff01@xwtextile.com';

  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'Expected exactly one staff01 profile, updated % rows', changed_rows;
  end if;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role_flag', 'staff')
  where regexp_replace(lower(coalesce(email, '')), '\s+', '', 'g') = 'staff01@xwtextile.com';
end $$;
