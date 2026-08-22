update public.profiles p
set display_name = '员工', updated_at = clock_timestamp()
from auth.users u
where p.id = u.id
  and regexp_replace(lower(coalesce(u.email, '')), '\s+', '', 'g') = 'staff01@xwtextile.com';
