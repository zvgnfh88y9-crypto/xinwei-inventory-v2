-- Remove the default PUBLIC execute privilege from the auth-only trigger function.
revoke execute on function public.handle_new_user() from public;
