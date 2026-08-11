create or replace function public.is_my_linked_company(target_company_id uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from client_profiles cp
    where cp.user_id=uid and cp.preferred_company_id=target_company_id
  ) or exists(
    select 1 from company_cleaners cc
    where cc.cleaner_id=uid and cc.company_id=target_company_id and cc.is_active
  );
$$;

revoke all on function public.is_my_linked_company(uuid,uuid) from public,anon;
grant execute on function public.is_my_linked_company(uuid,uuid) to authenticated;

drop policy if exists companies_read on public.company_profiles;
create policy companies_read on public.company_profiles for select to authenticated using(
  verification_status='approved'
  or owner_id=auth.uid()
  or public.is_admin()
  or public.is_my_linked_company(id)
);

