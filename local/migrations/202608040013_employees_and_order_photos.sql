alter table public.company_profiles add column if not exists employee_limit integer not null default 5 check(employee_limit between 1 and 500);

create or replace function public.enforce_company_employee_limit() returns trigger
language plpgsql security definer set search_path=public as $$
declare max_employees integer; current_employees integer;
begin
  if new.is_active then
    select employee_limit into max_employees from company_profiles where id=new.company_id;
    select count(*) into current_employees from company_cleaners where company_id=new.company_id and is_active and id<>new.id;
    if current_employees>=max_employees then raise exception 'Company employee limit reached'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists enforce_company_employee_limit on public.company_cleaners;
create trigger enforce_company_employee_limit before insert or update of is_active,company_id on public.company_cleaners
for each row execute function public.enforce_company_employee_limit();

create or replace function public.claim_company_order(target_order_id uuid) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); company_uuid uuid; result orders;
begin
  select cc.company_id into company_uuid from company_cleaners cc
  where cc.cleaner_id=uid and cc.is_active and exists(select 1 from cleaner_profiles cp where cp.user_id=uid and cp.verification_status='approved');
  if company_uuid is null then raise exception 'Approved company employee profile required'; end if;
  select * into result from orders where id=target_order_id and selected_company_id=company_uuid and status='accepted' for update;
  if not found then raise exception 'Company order is unavailable'; end if;
  update order_assignments set cleaner_id=uid where order_id=target_order_id and company_id=company_uuid and is_active and cleaner_id is null;
  if not found then raise exception 'Another employee already took this order'; end if;
  insert into notifications(user_id,order_id,type,title,body) values(result.client_id,result.id,'employee_assigned','Сотрудник назначен','Сотрудник компании взял ваш заказ');
  insert into notifications(user_id,order_id,type,title,body)
  select owner_id,result.id,'employee_assigned','Сотрудник взял заказ','Сотрудник назначен на заказ № '||result.order_number from company_profiles where id=company_uuid;
  return result;
end; $$;
grant execute on function public.claim_company_order(uuid) to authenticated;

drop policy if exists orders_participants_read on public.orders;
create policy orders_participants_read on public.orders for select to authenticated using(
 client_id=auth.uid() or public.is_admin() or
 (status in ('searching','offered') and exists(select 1 from public.cleaner_profiles where user_id=auth.uid() and verification_status='approved')) or
 exists(select 1 from public.company_profiles c where c.id=selected_company_id and c.owner_id=auth.uid()) or
 (status in ('accepted','on_the_way','arrived','in_progress','completed_by_cleaner') and public.is_my_linked_company(selected_company_id)) or
 exists(select 1 from public.order_assignments a where a.order_id=id and a.is_active and (a.cleaner_id=auth.uid() or exists(select 1 from public.company_profiles c where c.id=a.company_id and c.owner_id=auth.uid())))
);

create or replace function public.create_order(payload jsonb) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); svc cleaning_services; addr addresses; result orders; chosen_company uuid; photos text[];
begin
  if uid is null or not exists(select 1 from profiles where id=uid and role='client' and status='active') then raise exception 'Only active clients can create orders'; end if;
  select * into svc from cleaning_services where id=(payload->>'service_id')::uuid and is_active;
  if not found then raise exception 'Service is unavailable'; end if;
  select * into addr from addresses where id=(payload->>'address_id')::uuid and user_id=uid;
  if not found then raise exception 'Address not found'; end if;
  select coalesce(array_agg(value),array[]::text[]) into photos from jsonb_array_elements_text(coalesce(payload->'photo_urls','[]'));
  if cardinality(photos)=0 then raise exception 'At least one room photo is required'; end if;
  chosen_company:=nullif(payload->>'selected_company_id','')::uuid;
  if chosen_company is null then select preferred_company_id into chosen_company from client_profiles where user_id=uid; end if;
  if chosen_company is null or not exists(select 1 from company_profiles where id=chosen_company) then raise exception 'Choose a cleaning company before creating an order'; end if;
  update client_profiles set preferred_company_id=chosen_company where user_id=uid;
  insert into orders(client_id,service_id,address_id,city,address_text,scheduled_at,area_sq_m,rooms_count,comment,photo_urls,executor_preference,
    selected_company_id,status,payment_method,subtotal_minor,total_minor)
  values(uid,svc.id,addr.id,addr.city,addr.address_line,(payload->>'scheduled_at')::timestamptz,(payload->>'area_sq_m')::int,
    (payload->>'rooms_count')::int,payload->>'comment',photos,'company',chosen_company,'searching',(payload->>'payment_method')::payment_method,0,0)
  returning * into result;
  insert into order_items(order_id,name,unit_price_minor,total_minor) values(result.id,svc.name,0,0);
  insert into order_status_history(order_id,from_status,to_status,changed_by) values(result.id,'created','searching',uid);
  insert into notifications(user_id,order_id,type,title,body)
  select owner_id,result.id,'company_order','Новый запрос на уборку','Клиент добавил фото и ждёт вашу цену' from company_profiles where id=chosen_company;
  return result;
end; $$;
grant execute on function public.create_order(jsonb) to authenticated;

create or replace function public.notify_company_employees_after_accept() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='accepted' and old.status is distinct from 'accepted' and new.selected_company_id is not null then
    insert into notifications(user_id,order_id,type,title,body)
    select cc.cleaner_id,new.id,'company_order_available','Новый заказ компании','Откройте заказ и возьмите работу'
    from company_cleaners cc where cc.company_id=new.selected_company_id and cc.is_active;
  end if;
  return new;
end; $$;
drop trigger if exists notify_company_employees_after_accept on public.orders;
create trigger notify_company_employees_after_accept after update of status on public.orders
for each row execute function public.notify_company_employees_after_accept();

