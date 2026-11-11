-- Directory names remain discoverable without publishing personal contacts,
-- referral codes or consent records to every registered account.
create function public.can_read_profile_contact(target uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select target=auth.uid() or public.is_admin() or
    exists(select 1 from client_profiles cp join company_profiles c on c.id=cp.preferred_company_id where cp.user_id=target and c.owner_id=auth.uid()) or
    exists(select 1 from orders o where o.client_id=target and public.is_order_participant(o.id));
$$;
revoke all on function public.can_read_profile_contact(uuid) from public,anon;
grant execute on function public.can_read_profile_contact(uuid) to authenticated,service_role;
create view public.api_profiles with(security_invoker=true,security_barrier=true) as
  select id,role,full_name,avatar_url,city,status,created_at,updated_at,
    case when public.can_read_profile_contact(id) or current_user='service_role' then email end email,
    case when public.can_read_profile_contact(id) or current_user='service_role' then phone end phone,
    case when id=auth.uid() or public.is_admin() or current_user='service_role' then referral_code end referral_code,
    case when id=auth.uid() or public.is_admin() or current_user='service_role' then referred_by end referred_by,
    case when id=auth.uid() or public.is_admin() or current_user='service_role' then terms_accepted_at end terms_accepted_at,
    case when id=auth.uid() or public.is_admin() or current_user='service_role' then privacy_accepted_at end privacy_accepted_at
  from public.profiles;
grant select on public.api_profiles to authenticated,service_role;
-- Existing browser sessions predate HttpOnly; require a fresh login on upgrade.
delete from auth.sessions;
