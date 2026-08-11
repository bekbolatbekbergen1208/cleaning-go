alter table public.orders add column if not exists price_confirmed_at timestamptz;
alter table public.orders add column if not exists price_confirmed_by uuid references public.profiles(id);

create or replace function public.set_company_order_price(target_order_id uuid,target_total_minor bigint)
returns public.orders language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result orders;
begin
  if target_total_minor<10000 then raise exception 'Price must be at least 100 KZT'; end if;
  select o.* into result from orders o join company_profiles c on c.id=o.selected_company_id
  where o.id=target_order_id and c.owner_id=uid and o.status in ('searching','offered') for update of o;
  if not found then raise exception 'Order is unavailable for this company'; end if;
  update orders set subtotal_minor=target_total_minor,total_minor=target_total_minor,
    price_confirmed_at=now(),price_confirmed_by=uid where id=target_order_id returning * into result;
  update order_items set unit_price_minor=target_total_minor,total_minor=target_total_minor
  where order_id=target_order_id and service_option_id is null;
  insert into notifications(user_id,order_id,type,title,body,data)
  values(result.client_id,result.id,'company_price','Компания указала цену','Цена заказа: '||(target_total_minor/100)::text||' ₸',jsonb_build_object('total_minor',target_total_minor));
  return result;
end; $$;
grant execute on function public.set_company_order_price(uuid,bigint) to authenticated;

create or replace function public.accept_order(target_order_id uuid,target_company_id uuid default null) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result orders; role_now user_role; company_ok boolean:=false; previous_status order_status;
begin
  select role into role_now from profiles where id=uid and status='active';
  if role_now='cleaner' and not exists(select 1 from cleaner_profiles where user_id=uid and verification_status='approved') then raise exception 'Cleaner is not approved'; end if;
  if role_now='company_owner' then select exists(select 1 from company_profiles where id=target_company_id and owner_id=uid and verification_status='approved') into company_ok; end if;
  if role_now<>'cleaner' and not company_ok then raise exception 'Not an approved executor'; end if;
  select * into result from orders where id=target_order_id for update;
  if result.status not in ('searching','offered') then raise exception 'Order is no longer available'; end if;
  if role_now='company_owner' and (result.selected_company_id<>target_company_id or result.total_minor<=0 or result.price_confirmed_at is null) then
    raise exception 'Set the order price before accepting it';
  end if;
  previous_status:=result.status;
  if exists(select 1 from order_assignments where order_id=target_order_id and is_active) then raise exception 'Order already assigned'; end if;
  insert into order_assignments(order_id,cleaner_id,company_id,assigned_by,accepted_at)
  values(target_order_id,case when role_now='cleaner' then uid else null end,target_company_id,uid,now());
  update orders set status='accepted' where id=target_order_id returning * into result;
  insert into order_status_history(order_id,from_status,to_status,changed_by) values(target_order_id,previous_status,'accepted',uid);
  insert into notifications(user_id,order_id,type,title,body) values(result.client_id,result.id,'order_accepted','Заказ принят','Компания подтвердила ваш заказ и цену');
  return result;
end; $$;
grant execute on function public.accept_order(uuid,uuid) to authenticated;

-- New company orders start without a price. The company quotes it later.
create or replace function public.create_order(payload jsonb) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); svc cleaning_services; addr addresses; result orders; chosen_company uuid;
begin
  if uid is null or not exists(select 1 from profiles where id=uid and role='client' and status='active') then raise exception 'Only active clients can create orders'; end if;
  select * into svc from cleaning_services where id=(payload->>'service_id')::uuid and is_active;
  if not found then raise exception 'Service is unavailable'; end if;
  select * into addr from addresses where id=(payload->>'address_id')::uuid and user_id=uid;
  if not found then raise exception 'Address not found'; end if;
  chosen_company:=nullif(payload->>'selected_company_id','')::uuid;
  if chosen_company is null then select preferred_company_id into chosen_company from client_profiles where user_id=uid; end if;
  if chosen_company is null or not exists(select 1 from company_profiles where id=chosen_company) then raise exception 'Choose a cleaning company before creating an order'; end if;
  update client_profiles set preferred_company_id=chosen_company where user_id=uid;
  insert into orders(client_id,service_id,address_id,city,address_text,scheduled_at,area_sq_m,rooms_count,comment,executor_preference,
    selected_company_id,status,payment_method,subtotal_minor,total_minor)
  values(uid,svc.id,addr.id,addr.city,addr.address_line,(payload->>'scheduled_at')::timestamptz,(payload->>'area_sq_m')::int,
    (payload->>'rooms_count')::int,payload->>'comment','company',chosen_company,'searching',(payload->>'payment_method')::payment_method,0,0)
  returning * into result;
  insert into order_items(order_id,name,unit_price_minor,total_minor) values(result.id,svc.name,0,0);
  insert into order_status_history(order_id,from_status,to_status,changed_by) values(result.id,'created','searching',uid);
  insert into notifications(user_id,order_id,type,title,body)
  select owner_id,result.id,'company_order','Новый запрос на уборку','Клиент ждёт вашу цену' from company_profiles where id=chosen_company;
  return result;
end; $$;
grant execute on function public.create_order(jsonb) to authenticated;

