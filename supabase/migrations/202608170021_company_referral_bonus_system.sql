-- Consolidated, company-scoped invitation, referral and bonus system.
alter table public.company_profiles
  add column if not exists referral_bonus_minor bigint not null default 50000 check(referral_bonus_minor between 0 and 1000000),
  add column if not exists referral_enabled boolean not null default true;

alter table public.referral_codes add column if not exists company_id uuid references public.company_profiles(id) on delete cascade;
create index if not exists referral_codes_company_idx on public.referral_codes(company_id) where is_active;
update public.referral_codes rc set company_id=cp.preferred_company_id
from public.client_profiles cp where cp.user_id=rc.owner_id and rc.company_id is null and cp.preferred_company_id is not null;

alter table public.referrals
  add column if not exists company_id uuid references public.company_profiles(id) on delete restrict,
  add column if not exists bonus_amount_minor bigint not null default 0 check(bonus_amount_minor>=0),
  add column if not exists status text not null default 'pending' check(status in ('pending','rewarded','cancelled')),
  add column if not exists rewarded_at timestamptz;
update public.referrals r set company_id=rc.company_id from public.referral_codes rc where rc.id=r.code_id and r.company_id is null;
drop policy if exists referrals_read_company on public.referrals;
create policy referrals_read_company on public.referrals for select to authenticated using(
  exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid())
);

alter table public.company_cleaners
  add column if not exists membership_status text not null default 'active' check(membership_status in ('pending','active','rejected')),
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz;
update public.company_cleaners set membership_status=case when is_active then 'active' else 'rejected' end,
  approved_at=case when is_active then coalesce(approved_at,created_at) else approved_at end;

alter table public.orders add column if not exists requested_company_bonus_minor bigint not null default 0 check(requested_company_bonus_minor>=0);

alter table public.company_bonus_ledger
  add column if not exists referral_id uuid references public.referrals(id) on delete set null,
  add column if not exists description text,
  add column if not exists balance_after_minor bigint check(balance_after_minor>=0);
alter table public.company_bonus_ledger drop constraint if exists company_bonus_ledger_operation_check;
alter table public.company_bonus_ledger add constraint company_bonus_ledger_operation_check
  check(operation in ('welcome_grant','referral_grant','order_use','order_refund','admin_adjustment'));
create unique index if not exists one_company_referral_grant on public.company_bonus_ledger(referral_id) where operation='referral_grant';

create table if not exists public.company_code_uses(
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.company_profiles(id),
  client_id uuid not null references public.profiles(id), code_type text not null check(code_type in ('company','referral')),
  code_value text not null, referral_code_id uuid references public.referral_codes(id), created_at timestamptz not null default now(),
  unique(client_id)
);
alter table public.company_code_uses enable row level security;
create policy company_code_uses_parties on public.company_code_uses for select to authenticated using(
  client_id=auth.uid() or public.is_admin() or exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid())
);
grant select on public.company_code_uses to authenticated;

create or replace function public.add_company_bonus(target_client uuid,target_company uuid,target_operation text,target_amount bigint,target_referral uuid default null,target_order uuid default null,target_description text default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare new_balance bigint; inserted_id uuid;
begin
  if target_amount<=0 then return 0; end if;
  insert into company_bonus_balances(client_id,company_id,balance_minor) values(target_client,target_company,0) on conflict do nothing;
  insert into company_bonus_ledger(client_id,company_id,order_id,referral_id,operation,amount_minor,description)
  values(target_client,target_company,target_order,target_referral,target_operation,target_amount,target_description)
  on conflict do nothing returning id into inserted_id;
  if inserted_id is null then return 0; end if;
  update company_bonus_balances set balance_minor=balance_minor+target_amount,updated_at=now()
  where client_id=target_client and company_id=target_company returning balance_minor into new_balance;
  update company_bonus_ledger set balance_after_minor=new_balance where id=inserted_id;
  return target_amount;
end; $$;
revoke all on function public.add_company_bonus(uuid,uuid,text,bigint,uuid,uuid,text) from public,anon,authenticated;

create or replace function public.link_client_to_company(target_client uuid,input_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare normalized text:=upper(trim(input_code)); company_row company_profiles; referral_row referral_codes; referrer uuid; welcome_paid bigint:=0; referral_paid bigint:=0; referral_record uuid;
begin
  if auth.uid() is not null and auth.uid()<>target_client and not public.is_admin() then raise exception 'Forbidden'; end if;
  if normalized='' then raise exception 'Code is required'; end if;
  if not exists(select 1 from profiles where id=target_client and role='client' and status='active') then raise exception 'Active client required'; end if;
  if exists(select 1 from client_profiles where user_id=target_client and company_locked) then raise exception 'A company is already linked'; end if;

  select * into company_row from company_profiles where company_code=normalized and verification_status='approved';
  if found then
    insert into company_code_uses(company_id,client_id,code_type,code_value) values(company_row.id,target_client,'company',normalized);
  else
    select * into referral_row from referral_codes where code=normalized and is_active and company_id is not null;
    if not found then raise exception 'Invitation code is invalid or inactive'; end if;
    if referral_row.owner_id=target_client then raise exception 'Self-referral is not allowed'; end if;
    select * into company_row from company_profiles where id=referral_row.company_id and verification_status='approved' and referral_enabled;
    if not found then raise exception 'Company referral program is unavailable'; end if;
    referrer:=referral_row.owner_id;
    insert into company_code_uses(company_id,client_id,code_type,code_value,referral_code_id)
      values(company_row.id,target_client,'referral',normalized,referral_row.id);
    insert into referrals(referrer_id,referred_user_id,code_id,company_id,bonus_amount_minor,status,rewarded_at)
      values(referrer,target_client,referral_row.id,company_row.id,company_row.referral_bonus_minor,'rewarded',now())
      on conflict(referred_user_id) do nothing returning id into referral_record;
    if referral_record is null then raise exception 'Referral was already used'; end if;
    referral_paid:=public.add_company_bonus(referrer,company_row.id,'referral_grant',company_row.referral_bonus_minor,referral_record,null,'Досыңыз тіркелді');
  end if;

  update client_profiles set preferred_company_id=company_row.id,company_locked=true where user_id=target_client;
  update referral_codes set company_id=company_row.id where owner_id=target_client and company_id is null;
  welcome_paid:=public.add_company_bonus(target_client,company_row.id,'welcome_grant',company_row.welcome_bonus_minor,null,null,'Компанияға қосылғаны үшін бонус');
  insert into notifications(user_id,type,title,body,data) values(target_client,'company_invite','Код сәтті қолданылды','Сіз '||company_row.name||' компаниясына қосылдыңыз',jsonb_build_object('company_id',company_row.id,'welcome_bonus_minor',welcome_paid));
  insert into notifications(user_id,type,title,body,data) values(company_row.owner_id,'company_client','Жаңа клиент','Клиент компания немесе реферальдық код арқылы қосылды',jsonb_build_object('company_id',company_row.id,'client_id',target_client,'code_type',case when referrer is null then 'company' else 'referral' end));
  return jsonb_build_object('company_id',company_row.id,'company_name',company_row.name,'welcome_bonus_minor',welcome_paid,'referral_bonus_minor',referral_paid);
end; $$;
revoke all on function public.link_client_to_company(uuid,text) from public,anon,authenticated;

create or replace function public.apply_invitation_code(input_code text) returns jsonb
language plpgsql security definer set search_path=public as $$ begin return public.link_client_to_company(auth.uid(),input_code); end; $$;
grant execute on function public.apply_invitation_code(text) to authenticated;

create or replace function public.preview_invitation_code(input_code text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare normalized text:=upper(trim(input_code)); c company_profiles;
begin
  select * into c from company_profiles where company_code=normalized and verification_status='approved';
  if not found then select cp.* into c from referral_codes rc join company_profiles cp on cp.id=rc.company_id where rc.code=normalized and rc.is_active and cp.verification_status='approved' and cp.referral_enabled; end if;
  if not found then return null; end if;
  return jsonb_build_object('company_id',c.id,'company_name',c.name,'welcome_bonus_minor',c.welcome_bonus_minor);
end; $$;
grant execute on function public.preview_invitation_code(text) to authenticated;

create or replace function public.set_my_company_referral_settings(target_welcome_minor bigint,target_referral_minor bigint,target_enabled boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c company_profiles;
begin
  if target_welcome_minor not between 0 and 1000000 or target_referral_minor not between 0 and 1000000 then raise exception 'Bonus must be between 0 and 10000 KZT'; end if;
  update company_profiles set welcome_bonus_minor=target_welcome_minor,referral_bonus_minor=target_referral_minor,referral_enabled=target_enabled where owner_id=auth.uid() returning * into c;
  if not found then raise exception 'Company not found'; end if;
  return jsonb_build_object('welcome_bonus_minor',c.welcome_bonus_minor,'referral_bonus_minor',c.referral_bonus_minor,'referral_enabled',c.referral_enabled);
end; $$;
grant execute on function public.set_my_company_referral_settings(bigint,bigint,boolean) to authenticated;

create or replace function public.decide_company_membership(target_membership uuid,target_accept boolean) returns company_cleaners
language plpgsql security definer set search_path=public as $$
declare result company_cleaners;
begin
  select cc.* into result from company_cleaners cc join company_profiles c on c.id=cc.company_id where cc.id=target_membership and c.owner_id=auth.uid() and cc.membership_status='pending' for update of cc;
  if not found then raise exception 'Pending request not found'; end if;
  update company_cleaners set membership_status=case when target_accept then 'active' else 'rejected' end,is_active=target_accept,
    approved_at=case when target_accept then now() else null end,rejected_at=case when target_accept then null else now() end where id=target_membership returning * into result;
  insert into notifications(user_id,type,title,body,data) values(result.cleaner_id,'membership_decision',case when target_accept then 'Өтініш қабылданды' else 'Өтініш қабылданбады' end,case when target_accept then 'Сіз компания қызметкері болдыңыз' else 'Компания қосылу өтінішін қабылдамады' end,jsonb_build_object('company_id',result.company_id));
  return result;
end; $$;
grant execute on function public.decide_company_membership(uuid,boolean) to authenticated;

-- Existing clients receive a company-bound personal referral code.
update referral_codes rc set company_id=cp.preferred_company_id from client_profiles cp where cp.user_id=rc.owner_id and rc.company_id is null;

-- Store the requested amount; actual debit happens atomically when the company confirms the price.
create or replace function public.set_requested_company_bonus(target_order_id uuid,target_amount_minor bigint) returns orders
language plpgsql security definer set search_path=public as $$
declare result orders; available bigint;
begin
  select * into result from orders where id=target_order_id and client_id=auth.uid() and status in ('created','searching','offered') for update;
  if not found then raise exception 'Order is unavailable'; end if;
  select coalesce(balance_minor,0) into available from company_bonus_balances where client_id=auth.uid() and company_id=result.selected_company_id;
  if target_amount_minor<0 or target_amount_minor>coalesce(available,0) then raise exception 'Invalid bonus amount'; end if;
  update orders set requested_company_bonus_minor=target_amount_minor where id=target_order_id returning * into result;
  return result;
end; $$;
grant execute on function public.set_requested_company_bonus(uuid,bigint) to authenticated;

create or replace function public.create_order_with_bonus(payload jsonb) returns orders
language plpgsql security definer set search_path=public as $$
declare result orders; requested bigint:=coalesce((payload->>'bonus_amount_minor')::bigint,0);
begin
  result:=public.create_order(payload);
  if requested>0 then result:=public.set_requested_company_bonus(result.id,requested); end if;
  return result;
end; $$;
grant execute on function public.create_order_with_bonus(jsonb) to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
declare requested_role user_role; invite text; target_company uuid;
begin
  requested_role:=coalesce((new.raw_user_meta_data->>'role')::user_role,'client');
  if requested_role not in ('client','cleaner','company_owner') then requested_role:='client'; end if;
  invite:=upper(nullif(trim(new.raw_user_meta_data->>'referral_code'),''));
  if requested_role='cleaner' then
    select id into target_company from company_profiles where company_code=invite and verification_status='approved';
    if target_company is null then raise exception 'Valid company code is required'; end if;
  end if;
  insert into profiles(id,role,full_name,phone,email) values(new.id,requested_role,coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'Пользователь'),new.phone,new.email);
  insert into wallets(owner_id) values(new.id);
  insert into referral_codes(owner_id,code) select new.id,referral_code from profiles where id=new.id;
  if requested_role='client' then
    insert into client_profiles(user_id) values(new.id);
    if invite is not null then perform public.link_client_to_company(new.id,invite); end if;
  elsif requested_role='cleaner' then
    insert into cleaner_profiles(user_id) values(new.id);
    insert into company_cleaners(company_id,cleaner_id,is_active,membership_status) values(target_company,new.id,false,'pending');
    insert into notifications(user_id,type,title,body,data)
      select owner_id,'membership_request','Жаңа қосылу өтініші','Қызметкер компанияға қосылғысы келеді',jsonb_build_object('cleaner_id',new.id) from company_profiles where id=target_company;
  else
    if nullif(trim(new.raw_user_meta_data->>'company_name'),'') is null
      or nullif(trim(new.raw_user_meta_data->>'company_registration_number'),'') is null
      or nullif(trim(new.raw_user_meta_data->>'company_address'),'') is null
      or nullif(trim(new.raw_user_meta_data->>'company_city'),'') is null
      or nullif(trim(new.raw_user_meta_data->>'company_phone'),'') is null
    then raise exception 'Company registration details are required'; end if;
    insert into company_profiles(owner_id,name,registration_number,address,service_cities,contact_phone,contact_email)
    values(new.id,trim(new.raw_user_meta_data->>'company_name'),trim(new.raw_user_meta_data->>'company_registration_number'),trim(new.raw_user_meta_data->>'company_address'),array[trim(new.raw_user_meta_data->>'company_city')],trim(new.raw_user_meta_data->>'company_phone'),new.email);
  end if;
  return new;
exception when invalid_text_representation then raise exception 'Unsupported registration role';
end; $$;

create or replace function public.set_company_order_price(target_order_id uuid,target_total_minor bigint) returns orders
language plpgsql security definer set search_path=public as $$
declare result orders; available bigint:=0; used bigint:=0; previous_used bigint:=0; debit_id uuid;
begin
  if target_total_minor<10000 then raise exception 'Price must be at least 100 KZT'; end if;
  select o.* into result from orders o join company_profiles c on c.id=o.selected_company_id
    where o.id=target_order_id and c.owner_id=auth.uid() and o.status in ('searching','offered') for update of o;
  if not found then raise exception 'Order is unavailable for this company'; end if;
  previous_used:=result.company_bonus_used_minor;
  if previous_used>0 then update company_bonus_balances set balance_minor=balance_minor+previous_used where client_id=result.client_id and company_id=result.selected_company_id; end if;
  delete from company_bonus_ledger where order_id=result.id and operation='order_use';
  select coalesce(balance_minor,0) into available from company_bonus_balances where client_id=result.client_id and company_id=result.selected_company_id for update;
  used:=least(available,target_total_minor,result.requested_company_bonus_minor);
  if used>0 then
    update company_bonus_balances set balance_minor=balance_minor-used,updated_at=now() where client_id=result.client_id and company_id=result.selected_company_id returning balance_minor into available;
    insert into company_bonus_ledger(client_id,company_id,order_id,operation,amount_minor,balance_after_minor,description)
      values(result.client_id,result.selected_company_id,result.id,'order_use',used,available,'Тапсырысқа қолданылды')
      on conflict(order_id) where operation='order_use' do update set amount_minor=excluded.amount_minor,balance_after_minor=excluded.balance_after_minor returning id into debit_id;
  end if;
  update orders set subtotal_minor=target_total_minor,total_minor=target_total_minor-used,company_bonus_used_minor=used,price_confirmed_at=now(),price_confirmed_by=auth.uid() where id=target_order_id returning * into result;
  update order_items set unit_price_minor=target_total_minor,total_minor=target_total_minor where order_id=target_order_id and service_option_id is null;
  insert into notifications(user_id,order_id,type,title,body,data) values(result.client_id,result.id,'company_price','Компания указала цену','К оплате: '||(result.total_minor/100)::text||' ₸',jsonb_build_object('subtotal_minor',target_total_minor,'company_bonus_used_minor',used,'total_minor',result.total_minor));
  return result;
end; $$;
grant execute on function public.set_company_order_price(uuid,bigint) to authenticated;

create or replace function public.set_company_order_price(target_order_id uuid,target_total_minor bigint,target_required_workers integer) returns orders
language plpgsql security definer set search_path=public as $$
declare result orders;
begin
  if target_required_workers not between 1 and 100 then raise exception 'Required workers must be between 1 and 100'; end if;
  result:=public.set_company_order_price(target_order_id,target_total_minor);
  update orders set required_workers=target_required_workers where id=target_order_id returning * into result;
  return result;
end; $$;
grant execute on function public.set_company_order_price(uuid,bigint,integer) to authenticated;
