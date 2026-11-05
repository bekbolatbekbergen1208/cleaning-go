create function public.is_admin(uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = uid and role = 'admin' and status = 'active');
$$;

create function public.current_profile_role(uid uuid default auth.uid()) returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id=uid;
$$;
create function public.current_cleaner_verification(uid uuid default auth.uid()) returns public.verification_status
language sql stable security definer set search_path = public as $$
  select verification_status from cleaner_profiles where user_id=uid;
$$;
create function public.current_company_verification(company_owner uuid default auth.uid()) returns public.verification_status
language sql stable security definer set search_path = public as $$
  select verification_status from company_profiles where owner_id=company_owner;
$$;

create function public.protect_privileged_fields() returns trigger
language plpgsql set search_path=public as $$
begin
  if not public.is_admin() then
    if tg_table_name='profiles' then
      new.role:=old.role; new.status:=old.status; new.referral_code:=old.referral_code; new.referred_by:=old.referred_by;
    elsif tg_table_name='cleaner_profiles' then new.verification_status:=old.verification_status;
    elsif tg_table_name='company_profiles' then
      new.verification_status:=old.verification_status; new.tariff_status:=old.tariff_status;
    end if;
  end if;
  return new;
end; $$;
create trigger protect_profiles before update on public.profiles for each row execute function public.protect_privileged_fields();
create trigger protect_cleaner_profiles before update on public.cleaner_profiles for each row execute function public.protect_privileged_fields();
create trigger protect_company_profiles before update on public.company_profiles for each row execute function public.protect_privileged_fields();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare requested_role public.user_role; ref text; inviter uuid; inviter_role public.user_role; target_company uuid; is_company_code boolean:=false;
begin
  requested_role := coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'client');
  if requested_role not in ('client','cleaner','company_owner') then requested_role := 'client'; end if;
  if requested_role='company_owner' and (
    nullif(trim(new.raw_user_meta_data->>'company_name'),'') is null or
    nullif(trim(new.raw_user_meta_data->>'company_registration_number'),'') is null or
    nullif(trim(new.raw_user_meta_data->>'company_city'),'') is null or
    nullif(trim(new.raw_user_meta_data->>'company_address'),'') is null or
    nullif(trim(new.raw_user_meta_data->>'company_phone'),'') is null
  ) then raise exception 'Company registration details are required'; end if;
  ref := upper(nullif(trim(new.raw_user_meta_data->>'referral_code'),''));
  if ref is not null then
    select id into target_company from company_profiles where company_code=ref;
    is_company_code := target_company is not null;
  end if;
  if requested_role='cleaner' then
    if ref is null then raise exception 'Special company code is required for cleaner registration'; end if;
    if not is_company_code then raise exception 'Invalid cleaner company code'; end if;
  end if;
  insert into profiles(id, role, full_name, phone, email)
  values(new.id, requested_role, coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'Пользователь'), new.phone, new.email);
  insert into wallets(owner_id) values(new.id);
  insert into referral_codes(owner_id, code) select new.id, referral_code from profiles where id=new.id;
  if requested_role='client' then insert into client_profiles(user_id) values(new.id); end if;
  if requested_role='cleaner' then insert into cleaner_profiles(user_id) values(new.id); end if;
  if requested_role='company_owner' then
    insert into company_profiles(owner_id,name,registration_number,address,service_cities,contact_phone,contact_email)
    values(new.id,trim(new.raw_user_meta_data->>'company_name'),trim(new.raw_user_meta_data->>'company_registration_number'),
      trim(new.raw_user_meta_data->>'company_address'),array[trim(new.raw_user_meta_data->>'company_city')],
      trim(new.raw_user_meta_data->>'company_phone'),new.email);
  end if;
  if requested_role='cleaner' then
    insert into company_cleaners(company_id,cleaner_id) values(target_company,new.id);
  end if;
  if requested_role='client' and is_company_code then
    update client_profiles set preferred_company_id=target_company where user_id=new.id;
  end if;
  if ref is not null and not is_company_code then
    select owner_id into inviter from referral_codes where code=ref and is_active;
    if inviter is not null and inviter <> new.id then
      update profiles set referred_by=inviter where id=new.id and referred_by is null;
      insert into referrals(referrer_id,referred_user_id,code_id)
      select inviter,new.id,id from referral_codes where code=ref on conflict(referred_user_id) do nothing;
    end if;
  end if;
  return new;
exception when invalid_text_representation then
  raise exception 'Unsupported registration role';
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.create_order(payload jsonb) returns public.orders
language plpgsql security definer set search_path = public as $$
declare uid uuid:=auth.uid(); svc cleaning_services; addr addresses; cfg platform_settings; result orders;
  option_total bigint; subtotal bigint; total bigint; option_id uuid;
begin
  if uid is null or not exists(select 1 from profiles where id=uid and role='client' and status='active') then raise exception 'Only active clients can create orders'; end if;
  select * into svc from cleaning_services where id=(payload->>'service_id')::uuid and is_active;
  if not found then raise exception 'Service is unavailable'; end if;
  select * into addr from addresses where id=(payload->>'address_id')::uuid and user_id=uid;
  if not found then raise exception 'Address not found'; end if;
  select coalesce(sum(price_minor),0) into option_total from service_options
    where id in (select jsonb_array_elements_text(coalesce(payload->'option_ids','[]'))::uuid) and service_id=svc.id and is_active;
  subtotal := svc.base_price_minor + option_total;
  select * into cfg from platform_settings where id;
  total := greatest(subtotal, cfg.minimum_order_minor);
  insert into orders(client_id,service_id,address_id,city,address_text,scheduled_at,area_sq_m,rooms_count,comment,executor_preference,
    selected_cleaner_id,selected_company_id,status,payment_method,subtotal_minor,total_minor)
  values(uid,svc.id,addr.id,addr.city,addr.address_line,(payload->>'scheduled_at')::timestamptz,(payload->>'area_sq_m')::int,
    (payload->>'rooms_count')::int,payload->>'comment',coalesce((payload->>'executor_preference')::executor_preference,'any'),
    nullif(payload->>'selected_cleaner_id','')::uuid,nullif(payload->>'selected_company_id','')::uuid,'searching',(payload->>'payment_method')::payment_method,subtotal,total)
  returning * into result;
  insert into order_items(order_id,name,unit_price_minor,total_minor) values(result.id,svc.name,svc.base_price_minor,svc.base_price_minor);
  for option_id in select jsonb_array_elements_text(coalesce(payload->'option_ids','[]'))::uuid loop
    insert into order_items(order_id,service_option_id,name,unit_price_minor,total_minor)
    select result.id,id,name,price_minor,price_minor from service_options where id=option_id and service_id=svc.id and is_active;
  end loop;
  insert into order_status_history(order_id,from_status,to_status,changed_by) values(result.id,'created','searching',uid);
  return result;
end; $$;

create function public.accept_order(target_order_id uuid, target_company_id uuid default null) returns public.orders
language plpgsql security definer set search_path = public as $$
declare uid uuid:=auth.uid(); result orders; role_now user_role; company_ok boolean:=false; previous_status order_status;
begin
  select role into role_now from profiles where id=uid and status='active';
  if role_now='cleaner' and not exists(select 1 from cleaner_profiles where user_id=uid and verification_status='approved') then raise exception 'Cleaner is not approved'; end if;
  if role_now='company_owner' then
    select exists(select 1 from company_profiles where id=target_company_id and owner_id=uid and verification_status='approved') into company_ok;
  end if;
  if role_now <> 'cleaner' and not company_ok then raise exception 'Not an approved executor'; end if;
  select * into result from orders where id=target_order_id for update;
  if result.status not in ('searching','offered') then raise exception 'Order is no longer available'; end if;
  previous_status := result.status;
  if exists(select 1 from order_assignments where order_id=target_order_id and is_active) then raise exception 'Order already assigned'; end if;
  insert into order_assignments(order_id,cleaner_id,company_id,assigned_by,accepted_at)
  values(target_order_id,case when role_now='cleaner' then uid else null end,target_company_id,uid,now());
  update orders set status='accepted' where id=target_order_id returning * into result;
  insert into order_status_history(order_id,from_status,to_status,changed_by) values(target_order_id,previous_status,'accepted',uid);
  insert into notifications(user_id,order_id,type,title,body) values(result.client_id,result.id,'order_accepted','Заказ принят','Исполнитель подтвердил ваш заказ');
  return result;
end; $$;

create function public.is_order_participant(target_order_id uuid, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select public.is_admin(uid) or exists(select 1 from orders o where o.id=target_order_id and o.client_id=uid)
 or exists(select 1 from order_assignments a where a.order_id=target_order_id and a.is_active and (a.cleaner_id=uid or exists(select 1 from company_profiles c where c.id=a.company_id and c.owner_id=uid)));
$$;

create function public.finalize_order_finances(target_order_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare o orders; cfg platform_settings; ref referrals; reward_amount bigint:=0; platform_amount bigint; executor_amount bigint; w wallets;
begin
  select * into o from orders where id=target_order_id for update;
  select * into cfg from platform_settings where id;
  select * into ref from referrals where referred_user_id=o.client_id;
  if found and not exists(select 1 from referral_rewards where referred_user_id=o.client_id) then reward_amount:=round(o.total_minor*cfg.referral_fee_bps/10000.0); end if;
  platform_amount:=round(o.total_minor*cfg.platform_fee_bps/10000.0);
  executor_amount:=o.total_minor-platform_amount-reward_amount;
  if executor_amount<0 then raise exception 'Invalid platform settings'; end if;
  update orders set platform_fee_minor=platform_amount,referral_reward_minor=reward_amount,executor_amount_minor=executor_amount where id=o.id;
  if reward_amount>0 then
    insert into referral_rewards(referral_id,order_id,beneficiary_id,referred_user_id,amount_minor,percent_bps)
    values(ref.id,o.id,ref.referrer_id,o.client_id,reward_amount,cfg.referral_fee_bps);
    update wallets set available_minor=available_minor+reward_amount where owner_id=ref.referrer_id returning * into w;
    insert into wallet_transactions(wallet_id,owner_id,order_id,reward_id,type,amount_minor,balance_after_minor,description)
    select w.id,w.owner_id,o.id,r.id,'referral_reward',reward_amount,w.available_minor,'Награда за первый завершённый заказ'
    from referral_rewards r where r.order_id=o.id;
    insert into notifications(user_id,order_id,type,title,body,data) values(ref.referrer_id,o.id,'referral_reward','Начислена награда','Реферальное вознаграждение доступно',jsonb_build_object('amount_minor',reward_amount));
  end if;
end; $$;

create function public.transition_order_status(target_order_id uuid, next_status public.order_status, note text default null) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); o orders; assigned boolean; allowed boolean:=false; previous_status order_status;
begin
  select * into o from orders where id=target_order_id for update;
  if not found or not is_order_participant(target_order_id,uid) then raise exception 'Order unavailable'; end if;
  previous_status := o.status;
  select exists(select 1 from order_assignments where order_id=o.id and is_active and (cleaner_id=uid or exists(select 1 from company_profiles where id=company_id and owner_id=uid))) into assigned;
  allowed := is_admin(uid)
    or (uid=o.client_id and ((o.status='created' and next_status='cancelled') or (o.status='searching' and next_status='cancelled') or (o.status='completed_by_cleaner' and next_status='completed') or next_status='disputed'))
    or (assigned and ((o.status='accepted' and next_status='on_the_way') or (o.status='on_the_way' and next_status='arrived') or (o.status='arrived' and next_status='in_progress') or (o.status='in_progress' and next_status='completed_by_cleaner') or next_status='disputed'));
  if not allowed then raise exception 'Status transition is not allowed'; end if;
  update orders set status=next_status,completed_at=case when next_status='completed' then now() else completed_at end,
    cancelled_at=case when next_status='cancelled' then now() else cancelled_at end where id=o.id returning * into o;
  insert into order_status_history(order_id,from_status,to_status,changed_by,note) values(o.id,previous_status,next_status,uid,note);
  if next_status='completed' then perform finalize_order_finances(o.id); end if;
  insert into notifications(user_id,order_id,type,title,body) select o.client_id,o.id,'order_status','Статус заказа изменён','Новый статус: '||next_status where o.client_id<>uid;
  return o;
end; $$;

create function public.update_cleaner_location(target_order_id uuid, lat numeric, lng numeric, target_heading numeric default null, target_speed numeric default null) returns public.cleaner_locations
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result cleaner_locations;
begin
  if not exists(select 1 from orders o join order_assignments a on a.order_id=o.id and a.is_active where o.id=target_order_id and a.cleaner_id=uid and o.status in ('on_the_way','arrived','in_progress')) then raise exception 'Location sharing is inactive'; end if;
  insert into cleaner_locations(order_id,cleaner_id,latitude,longitude,heading,speed,recorded_at)
  values(target_order_id,uid,lat,lng,target_heading,target_speed,now())
  on conflict(order_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,heading=excluded.heading,speed=excluded.speed,recorded_at=now()
  returning * into result; return result;
end; $$;

create function public.create_review(target_order_id uuid, target_rating smallint, target_text text default null, target_tags text[] default '{}') returns public.reviews
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); o orders; a order_assignments; result reviews;
begin
  select * into o from orders where id=target_order_id and client_id=uid and status='completed'; if not found then raise exception 'Completed order not found'; end if;
  if target_rating not between 1 and 5 then raise exception 'Rating must be 1..5'; end if;
  select * into a from order_assignments where order_id=o.id and is_active order by created_at desc limit 1;
  insert into reviews(order_id,client_id,cleaner_id,company_id,rating,text,tags) values(o.id,uid,a.cleaner_id,a.company_id,target_rating,target_text,target_tags) returning * into result;
  if a.cleaner_id is not null then update cleaner_profiles cp set rating=x.avg,reviews_count=x.cnt from(select round(avg(rating),2) avg,count(*) cnt from reviews where cleaner_id=a.cleaner_id and is_visible)x where cp.user_id=a.cleaner_id; end if;
  if a.company_id is not null then update company_profiles cp set rating=x.avg,reviews_count=x.cnt from(select round(avg(rating),2) avg,count(*) cnt from reviews where company_id=a.company_id and is_visible)x where cp.id=a.company_id; end if;
  return result;
end; $$;

create function public.open_dispute(target_order_id uuid, target_reason text, target_description text) returns public.disputes
language plpgsql security definer set search_path=public as $$
declare result disputes;
begin
  if not is_order_participant(target_order_id) then raise exception 'Order unavailable'; end if;
  insert into disputes(order_id,opened_by,reason,description) values(target_order_id,auth.uid(),target_reason,target_description) returning * into result;
  perform transition_order_status(target_order_id,'disputed','Спор открыт'); return result;
end; $$;

revoke all on function public.finalize_order_finances(uuid) from public, anon, authenticated;
grant execute on function public.create_order(jsonb), public.accept_order(uuid,uuid), public.transition_order_status(uuid,public.order_status,text), public.update_cleaner_location(uuid,numeric,numeric,numeric,numeric), public.create_review(uuid,smallint,text,text[]), public.open_dispute(uuid,text,text) to authenticated;
