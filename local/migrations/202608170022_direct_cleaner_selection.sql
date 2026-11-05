-- A client may choose either an approved independent cleaner or an approved company.
-- A locked company code always takes precedence over a direct-cleaner choice.
create or replace function public.create_order(payload jsonb) returns public.orders
language plpgsql security definer set search_path=public as $$
declare
  uid uuid := auth.uid(); svc cleaning_services; addr addresses; result orders;
  chosen_company uuid; chosen_cleaner uuid; preferred_company uuid; locked boolean; photos text[];
begin
  if uid is null or not exists(select 1 from profiles where id=uid and role='client' and status='active') then
    raise exception 'Only active clients can create orders';
  end if;
  select * into svc from cleaning_services where id=(payload->>'service_id')::uuid and is_active;
  if not found then raise exception 'Service is unavailable'; end if;
  select * into addr from addresses where id=(payload->>'address_id')::uuid and user_id=uid;
  if not found then raise exception 'Address not found'; end if;
  select coalesce(array_agg(value), array[]::text[]) into photos from jsonb_array_elements_text(coalesce(payload->'photo_urls','[]'));
  if cardinality(photos)=0 then raise exception 'At least one room photo is required'; end if;

  select preferred_company_id, company_locked into preferred_company, locked from client_profiles where user_id=uid for update;
  chosen_company := nullif(payload->>'selected_company_id','')::uuid;
  chosen_cleaner := nullif(payload->>'selected_cleaner_id','')::uuid;
  if locked then
    chosen_company := preferred_company;
    chosen_cleaner := null;
    if chosen_company is null then raise exception 'Locked company is unavailable'; end if;
  end if;
  if chosen_company is not null and chosen_cleaner is not null then raise exception 'Choose one executor'; end if;
  if chosen_company is null and chosen_cleaner is null then chosen_company := preferred_company; end if;

  if chosen_company is not null then
    if not exists(select 1 from company_profiles c where c.id=chosen_company and c.verification_status='approved'
      and exists(select 1 from unnest(c.service_cities) city where lower(trim(city))=lower(trim(addr.city)))) then
      raise exception 'The company does not serve this city';
    end if;
    if not locked then update client_profiles set preferred_company_id=chosen_company where user_id=uid; end if;
  elsif not exists(select 1 from cleaner_profiles cp join profiles p on p.id=cp.user_id
    where cp.user_id=chosen_cleaner and cp.verification_status='approved' and cp.is_available and p.status='active'
      and (cp.work_zone is null or lower(trim(cp.work_zone))=lower(trim(addr.city)))) then
    raise exception 'The cleaner is unavailable in this city';
  end if;

  insert into orders(client_id,service_id,address_id,city,address_text,scheduled_at,area_sq_m,rooms_count,comment,photo_urls,
    executor_preference,selected_cleaner_id,selected_company_id,status,payment_method,subtotal_minor,total_minor)
  values(uid,svc.id,addr.id,addr.city,addr.address_line,(payload->>'scheduled_at')::timestamptz,(payload->>'area_sq_m')::int,
    (payload->>'rooms_count')::int,payload->>'comment',photos,
    case when chosen_cleaner is null then 'company'::executor_preference else 'cleaner'::executor_preference end,
    chosen_cleaner,chosen_company,'searching',(payload->>'payment_method')::payment_method,
    case when chosen_cleaner is null then 0 else svc.base_price_minor end,
    case when chosen_cleaner is null then 0 else svc.base_price_minor end)
  returning * into result;
  insert into order_items(order_id,name,unit_price_minor,total_minor)
  values(result.id,svc.name,case when chosen_cleaner is null then 0 else svc.base_price_minor end,case when chosen_cleaner is null then 0 else svc.base_price_minor end);
  insert into order_status_history(order_id,from_status,to_status,changed_by) values(result.id,'created','searching',uid);
  if chosen_company is not null then
    insert into notifications(user_id,order_id,type,title,body) select owner_id,result.id,'company_order','Новый запрос на уборку','Клиент добавил фото и ждёт вашу цену' from company_profiles where id=chosen_company;
  else
    insert into notifications(user_id,order_id,type,title,body) values(chosen_cleaner,result.id,'cleaner_order','Новый запрос на уборку','Клиент выбрал вас исполнителем');
  end if;
  return result;
end; $$;

create or replace function public.accept_order(target_order_id uuid, target_company_id uuid default null) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result orders; role_now user_role; company_ok boolean:=false; previous_status order_status;
begin
  select role into role_now from profiles where id=uid and status='active';
  if role_now='cleaner' and not exists(select 1 from cleaner_profiles where user_id=uid and verification_status='approved') then raise exception 'Cleaner is not approved'; end if;
  if role_now='company_owner' then select exists(select 1 from company_profiles where id=target_company_id and owner_id=uid and verification_status='approved') into company_ok; end if;
  if role_now<>'cleaner' and not company_ok then raise exception 'Not an approved executor'; end if;
  select * into result from orders where id=target_order_id for update;
  if result.status not in ('searching','offered') then raise exception 'Order is no longer available'; end if;
  if role_now='cleaner' and result.selected_cleaner_id is not null and result.selected_cleaner_id<>uid then raise exception 'This order was assigned to another cleaner'; end if;
  if role_now='cleaner' and result.selected_company_id is not null then raise exception 'This order belongs to a company'; end if;
  if role_now='company_owner' and (result.selected_company_id<>target_company_id or result.total_minor<=0 or result.price_confirmed_at is null) then raise exception 'Set the order price before accepting it'; end if;
  previous_status:=result.status;
  if exists(select 1 from order_assignments where order_id=target_order_id and is_active) then raise exception 'Order already assigned'; end if;
  insert into order_assignments(order_id,cleaner_id,company_id,assigned_by,accepted_at) values(target_order_id,case when role_now='cleaner' then uid else null end,target_company_id,uid,now());
  update orders set status='accepted' where id=target_order_id returning * into result;
  insert into order_status_history(order_id,from_status,to_status,changed_by) values(target_order_id,previous_status,'accepted',uid);
  insert into notifications(user_id,order_id,type,title,body) values(result.client_id,result.id,'order_accepted','Заказ принят','Исполнитель подтвердил ваш заказ');
  return result;
end; $$;

grant execute on function public.create_order(jsonb), public.accept_order(uuid,uuid) to authenticated;
