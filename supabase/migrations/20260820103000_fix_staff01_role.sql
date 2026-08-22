-- staff01 is the employee account. Login-page tabs are presentation only;
-- authorization always follows this server-side profile role.
update public.profiles
set role = 'staff', updated_at = now()
where id in (
  select id from auth.users where lower(email) = 'staff01@xwtextile.com'
);
