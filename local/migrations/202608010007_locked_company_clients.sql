alter table public.client_profiles
  add column if not exists company_locked boolean not null default false;

-- Existing clients linked by the registration trigger are treated as code-linked.
update public.client_profiles cp
set company_locked=true
where preferred_company_id is not null
  and exists(
    select 1 from public.profiles p
    where p.id=cp.user_id and p.referred_by is null
  );

create or replace function public.choose_company(target_company_id uuid)
returns public.company_profiles
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result public.company_profiles;
begin
  if uid is null or not exists(select 1 from profiles where id=uid and role='client' and status='active') then
    raise exception 'Only active clients can choose a company';
  end if;
  if exists(select 1 from client_profiles where user_id=uid and company_locked) then
    raise exception 'Your company is fixed by the registration code';
  end if;
  select * into result from company_profiles
  where id=target_company_id and verification_status='approved';
  if not found then raise exception 'Company is unavailable'; end if;
  update client_profiles set preferred_company_id=result.id where user_id=uid;
  return result;
end; $$;

grant execute on function public.choose_company(uuid) to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare requested_role public.user_role; ref text; inviter uuid; target_company uuid; is_company_code boolean:=false;
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
  insert into profiles(id,role,full_name,phone,email)
  values(new.id,requested_role,coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'Пользователь'),new.phone,new.email);
  insert into wallets(owner_id) values(new.id);
  insert into referral_codes(owner_id,code) select new.id,referral_code from profiles where id=new.id;
  if requested_role='client' then insert into client_profiles(user_id) values(new.id); end if;
  if requested_role='cleaner' then insert into cleaner_profiles(user_id) values(new.id); end if;
  if requested_role='company_owner' then
    insert into company_profiles(owner_id,name,registration_number,address,service_cities,contact_phone,contact_email)
    values(new.id,trim(new.raw_user_meta_data->>'company_name'),trim(new.raw_user_meta_data->>'company_registration_number'),
      trim(new.raw_user_meta_data->>'company_address'),array[trim(new.raw_user_meta_data->>'company_city')],
      trim(new.raw_user_meta_data->>'company_phone'),new.email);
  end if;
  if requested_role='cleaner' then insert into company_cleaners(company_id,cleaner_id) values(target_company,new.id); end if;
  if requested_role='client' and is_company_code then
    update client_profiles set preferred_company_id=target_company,company_locked=true where user_id=new.id;
  end if;
  if ref is not null and not is_company_code then
    select owner_id into inviter from referral_codes where code=ref and is_active;
    if inviter is not null and inviter<>new.id then
      update profiles set referred_by=inviter where id=new.id and referred_by is null;
      insert into referrals(referrer_id,referred_user_id,code_id)
      select inviter,new.id,id from referral_codes where code=ref on conflict(referred_user_id) do nothing;
    end if;
  end if;
  return new;
exception when invalid_text_representation then raise exception 'Unsupported registration role';
end; $$;
