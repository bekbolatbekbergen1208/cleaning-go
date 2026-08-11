-- A client belongs to one preferred company. Every new order is routed to it.
create or replace function public.choose_company(target_company_id uuid)
returns public.company_profiles
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result public.company_profiles;
begin
  if uid is null or not exists(select 1 from profiles where id=uid and role='client' and status='active') then
    raise exception 'Only active clients can choose a company';
  end if;
  select * into result from company_profiles
  where id=target_company_id and verification_status='approved';
  if not found then raise exception 'Company is unavailable'; end if;
  update client_profiles set preferred_company_id=result.id where user_id=uid;
  return result;
end; $$;

grant execute on function public.choose_company(uuid) to authenticated;

create or replace function public.get_my_company_report()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare uid uuid:=auth.uid(); company_id uuid; result jsonb;
begin
  select id into company_id from company_profiles where owner_id=uid;
  if company_id is null then raise exception 'Company profile not found'; end if;

  select jsonb_build_object(
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

create or replace function public.is_order_participant(target_order_id uuid, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select public.is_admin(uid)
 or exists(select 1 from orders o where o.id=target_order_id and o.client_id=uid)
 or exists(
   select 1 from orders o join company_profiles c on c.id=o.selected_company_id
   where o.id=target_order_id and c.owner_id=uid
 )
 or exists(
   select 1 from order_assignments a where a.order_id=target_order_id and a.is_active
   and (a.cleaner_id=uid or exists(select 1 from company_profiles c where c.id=a.company_id and c.owner_id=uid))
 );
$$;

drop policy if exists orders_participants_read on public.orders;
create policy orders_participants_read on public.orders for select to authenticated using(
 client_id=auth.uid() or public.is_admin() or
 (status in ('searching','offered') and exists(select 1 from public.cleaner_profiles where user_id=auth.uid() and verification_status='approved')) or
 exists(select 1 from public.company_profiles c where c.id=selected_company_id and c.owner_id=auth.uid()) or
 exists(select 1 from public.order_assignments a where a.order_id=id and a.is_active and (a.cleaner_id=auth.uid() or exists(select 1 from public.company_profiles c where c.id=a.company_id and c.owner_id=auth.uid())))
);

create or replace function public.create_order(payload jsonb) returns public.orders
language plpgsql security definer set search_path = public as $$
declare uid uuid:=auth.uid(); svc cleaning_services; addr addresses; cfg platform_settings; result orders;
  option_total bigint; subtotal bigint; total bigint; option_id uuid; chosen_company uuid;
begin
  if uid is null or not exists(select 1 from profiles where id=uid and role='client' and status='active') then raise exception 'Only active clients can create orders'; end if;
  select * into svc from cleaning_services where id=(payload->>'service_id')::uuid and is_active;
  if not found then raise exception 'Service is unavailable'; end if;
  select * into addr from addresses where id=(payload->>'address_id')::uuid and user_id=uid;
  if not found then raise exception 'Address not found'; end if;

  chosen_company := nullif(payload->>'selected_company_id','')::uuid;
  if chosen_company is null then select preferred_company_id into chosen_company from client_profiles where user_id=uid; end if;
  if chosen_company is null then raise exception 'Choose a cleaning company before creating an order'; end if;
  if not exists(select 1 from company_profiles where id=chosen_company) then raise exception 'Company is unavailable'; end if;
  update client_profiles set preferred_company_id=chosen_company where user_id=uid;

  select coalesce(sum(price_minor),0) into option_total from service_options
    where id in (select jsonb_array_elements_text(coalesce(payload->'option_ids','[]'))::uuid) and service_id=svc.id and is_active;
  subtotal := svc.base_price_minor + option_total;
  select * into cfg from platform_settings where id;
  total := greatest(subtotal, cfg.minimum_order_minor);
  insert into orders(client_id,service_id,address_id,city,address_text,scheduled_at,area_sq_m,rooms_count,comment,executor_preference,
    selected_cleaner_id,selected_company_id,status,payment_method,subtotal_minor,total_minor)
  values(uid,svc.id,addr.id,addr.city,addr.address_line,(payload->>'scheduled_at')::timestamptz,(payload->>'area_sq_m')::int,
    (payload->>'rooms_count')::int,payload->>'comment','company',null,chosen_company,'searching',(payload->>'payment_method')::payment_method,subtotal,total)
  returning * into result;
  insert into order_items(order_id,name,unit_price_minor,total_minor) values(result.id,svc.name,svc.base_price_minor,svc.base_price_minor);
  for option_id in select jsonb_array_elements_text(coalesce(payload->'option_ids','[]'))::uuid loop
    insert into order_items(order_id,service_option_id,name,unit_price_minor,total_minor)
    select result.id,id,name,price_minor,price_minor from service_options where id=option_id and service_id=svc.id and is_active;
  end loop;
  insert into order_status_history(order_id,from_status,to_status,changed_by) values(result.id,'created','searching',uid);
  insert into notifications(user_id,order_id,type,title,body)
  select owner_id,result.id,'company_order','Новый заказ','Ваш клиент создал новый заказ'
  from company_profiles where id=chosen_company;
  return result;
end; $$;

