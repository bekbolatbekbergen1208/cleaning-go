-- Companies own client relationships and publish confirmed orders to one
-- platform-wide cleaner community. Cleaners are not company employees.

drop trigger if exists notify_company_employees_after_accept on public.orders;
drop function if exists public.notify_company_employees_after_accept();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
declare requested_role user_role; invite text;
begin
  requested_role:=coalesce((new.raw_user_meta_data->>'role')::user_role,'client');
  if requested_role not in ('client','cleaner','company_owner') then requested_role:='client'; end if;
  invite:=upper(nullif(trim(new.raw_user_meta_data->>'referral_code'),''));
  insert into profiles(id,role,full_name,phone,email) values(new.id,requested_role,coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'Пользователь'),new.phone,new.email);
  insert into wallets(owner_id) values(new.id);
  insert into referral_codes(owner_id,code) select new.id,referral_code from profiles where id=new.id;
  if requested_role='client' then
    insert into client_profiles(user_id) values(new.id);
    if invite is not null then perform public.link_client_to_company(new.id,invite); end if;
  elsif requested_role='cleaner' then
    insert into cleaner_profiles(user_id) values(new.id);
  else
    if nullif(trim(new.raw_user_meta_data->>'company_name'),'') is null or nullif(trim(new.raw_user_meta_data->>'company_registration_number'),'') is null or nullif(trim(new.raw_user_meta_data->>'company_address'),'') is null or nullif(trim(new.raw_user_meta_data->>'company_city'),'') is null or nullif(trim(new.raw_user_meta_data->>'company_phone'),'') is null then raise exception 'Company registration details are required'; end if;
    insert into company_profiles(owner_id,name,registration_number,address,service_cities,contact_phone,contact_email)
    values(new.id,trim(new.raw_user_meta_data->>'company_name'),trim(new.raw_user_meta_data->>'company_registration_number'),trim(new.raw_user_meta_data->>'company_address'),array[trim(new.raw_user_meta_data->>'company_city')],trim(new.raw_user_meta_data->>'company_phone'),new.email);
  end if;
  return new;
exception when invalid_text_representation then raise exception 'Unsupported registration role';
end; $$;

create or replace function public.claim_company_order(target_order_id uuid) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result orders; current_workers integer; company_owner_id uuid;
begin
  if not exists(select 1 from cleaner_profiles cp join profiles p on p.id=cp.user_id where cp.user_id=uid and cp.verification_status='approved' and cp.is_available and p.status='active') then raise exception 'Approved and available cleaner profile required'; end if;
  select * into result from orders where id=target_order_id and selected_company_id is not null and status='accepted' and scheduled_at>now() for update;
  if not found then raise exception 'Community order is unavailable'; end if;
  if exists(select 1 from order_workers where order_id=target_order_id and cleaner_id=uid) then return result; end if;
  select count(*) into current_workers from order_workers where order_id=target_order_id;
  if current_workers>=result.required_workers then raise exception 'All cleaner places for this order are already filled'; end if;
  insert into order_workers(order_id,cleaner_id) values(target_order_id,uid);
  select owner_id into company_owner_id from company_profiles where id=result.selected_company_id;
  insert into notifications(user_id,order_id,type,title,body) values
    (result.client_id,result.id,'cleaner_assigned','Клинер найден','Клинер из сообщества взял ваш заказ'),
    (company_owner_id,result.id,'cleaner_assigned','Клинер взял заказ','Клинер из общего сообщества присоединился к заказу');
  return result;
end; $$;
grant execute on function public.claim_company_order(uuid) to authenticated;

drop policy if exists orders_participants_read on public.orders;
create policy orders_participants_read on public.orders for select to authenticated using(
  client_id=auth.uid() or public.is_admin() or
  exists(select 1 from public.company_profiles c where c.id=selected_company_id and c.owner_id=auth.uid()) or
  exists(select 1 from public.order_workers w where w.order_id=id and w.cleaner_id=auth.uid()) or
  (status='accepted' and selected_company_id is not null and scheduled_at>now() and exists(select 1 from public.cleaner_profiles cp join public.profiles p on p.id=cp.user_id where cp.user_id=auth.uid() and cp.verification_status='approved' and cp.is_available and p.status='active'))
);

create or replace function public.notify_cleaner_community_after_publish() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='accepted' and old.status is distinct from 'accepted' and new.selected_company_id is not null then
    insert into notifications(user_id,order_id,type,title,body)
    select cp.user_id,new.id,'community_order_available','Новый заказ в сообществе','Откройте заказ и возьмите свободное место'
    from cleaner_profiles cp join profiles p on p.id=cp.user_id where cp.verification_status='approved' and cp.is_available and p.status='active';
  end if;
  return new;
end; $$;
create trigger notify_cleaner_community_after_publish after update of status on public.orders for each row execute function public.notify_cleaner_community_after_publish();
