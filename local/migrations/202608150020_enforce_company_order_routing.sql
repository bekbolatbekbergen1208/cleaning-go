create or replace function public.create_order(payload jsonb) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); svc cleaning_services; addr addresses; result orders; chosen_company uuid; preferred_company uuid; locked boolean; photos text[];
begin
  if uid is null or not exists(select 1 from profiles where id=uid and role='client' and status='active') then raise exception 'Only active clients can create orders'; end if;
  select * into svc from cleaning_services where id=(payload->>'service_id')::uuid and is_active;
  if not found then raise exception 'Service is unavailable'; end if;
  select * into addr from addresses where id=(payload->>'address_id')::uuid and user_id=uid;
  if not found then raise exception 'Address not found'; end if;
  select coalesce(array_agg(value),array[]::text[]) into photos from jsonb_array_elements_text(coalesce(payload->'photo_urls','[]'));
  if cardinality(photos)=0 then raise exception 'At least one room photo is required'; end if;

  select preferred_company_id,company_locked into preferred_company,locked from client_profiles where user_id=uid for update;
  if locked then
    if preferred_company is null then raise exception 'Locked company is unavailable'; end if;
    chosen_company:=preferred_company;
  else
    chosen_company:=nullif(payload->>'selected_company_id','')::uuid;
    if chosen_company is null then chosen_company:=preferred_company; end if;
    if chosen_company is null then raise exception 'Choose a cleaning company before creating an order'; end if;
    if not exists(
      select 1 from company_profiles c
      where c.id=chosen_company and c.verification_status='approved'
        and exists(select 1 from unnest(c.service_cities) city where lower(trim(city))=lower(trim(addr.city)))
    ) then raise exception 'The company does not serve this city'; end if;
    update client_profiles set preferred_company_id=chosen_company where user_id=uid;
  end if;

  if not exists(select 1 from company_profiles where id=chosen_company and verification_status='approved') then raise exception 'Company is unavailable'; end if;
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
