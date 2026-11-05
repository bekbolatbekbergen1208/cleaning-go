create or replace function public.get_my_company_report()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare uid uuid:=auth.uid(); company_id uuid; result jsonb;
begin
  select id into company_id from company_profiles where owner_id=uid;
  if company_id is null then raise exception 'Company profile not found'; end if;
  select jsonb_build_object(
    'company_code', (select company_code from company_profiles where id=company_id),
    'verification_status', (select verification_status from company_profiles where id=company_id),
    'clients', (select count(*) from client_profiles where preferred_company_id=company_id),
    'orders_total', (select count(*) from orders where selected_company_id=company_id),
    'orders_active', (select count(*) from orders where selected_company_id=company_id and status not in ('completed','cancelled')),
    'orders_completed', (select count(*) from orders where selected_company_id=company_id and status='completed'),
    'revenue_minor', (select coalesce(sum(executor_amount_minor),0) from orders where selected_company_id=company_id and status='completed'),
    'rating', (select rating from company_profiles where id=company_id),
    'reviews_count', (select reviews_count from company_profiles where id=company_id)
  ) into result;
  return result;
end; $$;

grant execute on function public.get_my_company_report() to authenticated;

