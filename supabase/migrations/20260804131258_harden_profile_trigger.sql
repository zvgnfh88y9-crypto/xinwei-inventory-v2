-- The profile trigger is invoked by auth.users inserts, not by public API callers.
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
;
