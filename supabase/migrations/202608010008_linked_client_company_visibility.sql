drop policy if exists companies_read on public.company_profiles;
create policy companies_read on public.company_profiles for select to authenticated using(
  verification_status='approved'
  or owner_id=auth.uid()
  or public.is_admin()
  or exists(
    select 1 from public.client_profiles cp
    where cp.user_id=auth.uid() and cp.preferred_company_id=company_profiles.id
  )
  or exists(
    select 1 from public.company_cleaners cc
    where cc.cleaner_id=auth.uid() and cc.company_id=company_profiles.id and cc.is_active
  )
);

