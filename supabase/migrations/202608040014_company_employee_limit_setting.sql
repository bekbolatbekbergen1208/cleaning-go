create or replace function public.set_my_company_employee_limit(target_limit integer)
returns integer language plpgsql security definer set search_path=public as $$
declare current_count integer;
begin
  if target_limit not between 1 and 500 then raise exception 'Employee limit must be between 1 and 500'; end if;
  select count(*) into current_count from company_cleaners cc join company_profiles c on c.id=cc.company_id
  where c.owner_id=auth.uid() and cc.is_active;
  if target_limit<current_count then raise exception 'Limit cannot be lower than the current employee count'; end if;
  update company_profiles set employee_limit=target_limit where owner_id=auth.uid();
  if not found then raise exception 'Company profile not found'; end if;
  return target_limit;
end; $$;
grant execute on function public.set_my_company_employee_limit(integer) to authenticated;

