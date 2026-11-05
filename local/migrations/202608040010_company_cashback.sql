alter table public.company_profiles
  add column if not exists cashback_bps integer not null default 500 check(cashback_bps between 0 and 2000);

alter table public.orders
  add column if not exists company_cashback_minor bigint not null default 0 check(company_cashback_minor>=0);

create table if not exists public.company_cashback_rewards(
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  company_id uuid not null references public.company_profiles(id) on delete restrict,
  client_id uuid not null references public.profiles(id) on delete restrict,
  amount_minor bigint not null check(amount_minor>0),
  percent_bps integer not null check(percent_bps between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.company_cashback_rewards enable row level security;
drop policy if exists cashback_parties_read on public.company_cashback_rewards;
create policy cashback_parties_read on public.company_cashback_rewards for select to authenticated using(
  client_id=auth.uid() or public.is_admin() or exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid())
);
grant select on public.company_cashback_rewards to authenticated;

create or replace function public.set_my_company_cashback(target_bps integer)
returns integer language plpgsql security definer set search_path=public as $$
begin
  if target_bps not between 0 and 2000 then raise exception 'Cashback must be between 0 and 20 percent'; end if;
  update company_profiles set cashback_bps=target_bps where owner_id=auth.uid();
  if not found then raise exception 'Company profile not found'; end if;
  return target_bps;
end; $$;
grant execute on function public.set_my_company_cashback(integer) to authenticated;

create or replace function public.finalize_order_finances(target_order_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare o orders; cfg platform_settings; ref referrals; reward_amount bigint:=0; cashback_amount bigint:=0;
  cashback_bps integer:=0; platform_amount bigint; executor_amount bigint; w wallets; cashback_id uuid;
begin
  select * into o from orders where id=target_order_id for update;
  select * into cfg from platform_settings where id;
  select * into ref from referrals where referred_user_id=o.client_id;
  if found and not exists(select 1 from referral_rewards where referred_user_id=o.client_id) then
    reward_amount:=round(o.total_minor*cfg.referral_fee_bps/10000.0);
  end if;
  if o.selected_company_id is not null and exists(
    select 1 from client_profiles cp where cp.user_id=o.client_id and cp.company_locked and cp.preferred_company_id=o.selected_company_id
  ) and not exists(select 1 from company_cashback_rewards where order_id=o.id) then
    select c.cashback_bps into cashback_bps from company_profiles c where c.id=o.selected_company_id;
    cashback_amount:=round(o.total_minor*cashback_bps/10000.0);
  end if;
  platform_amount:=round(o.total_minor*cfg.platform_fee_bps/10000.0);
  executor_amount:=o.total_minor-platform_amount-reward_amount-cashback_amount;
  if executor_amount<0 then raise exception 'Invalid platform or cashback settings'; end if;
  update orders set platform_fee_minor=platform_amount,referral_reward_minor=reward_amount,
    company_cashback_minor=cashback_amount,executor_amount_minor=executor_amount where id=o.id;
  if reward_amount>0 then
    insert into referral_rewards(referral_id,order_id,beneficiary_id,referred_user_id,amount_minor,percent_bps)
    values(ref.id,o.id,ref.referrer_id,o.client_id,reward_amount,cfg.referral_fee_bps);
    update wallets set available_minor=available_minor+reward_amount where owner_id=ref.referrer_id returning * into w;
    insert into wallet_transactions(wallet_id,owner_id,order_id,reward_id,type,amount_minor,balance_after_minor,description)
    select w.id,w.owner_id,o.id,r.id,'referral_reward',reward_amount,w.available_minor,'Награда за первый завершённый заказ'
    from referral_rewards r where r.order_id=o.id;
    insert into notifications(user_id,order_id,type,title,body,data) values(ref.referrer_id,o.id,'referral_reward','Начислена награда','Реферальное вознаграждение доступно',jsonb_build_object('amount_minor',reward_amount));
  end if;
  if cashback_amount>0 then
    insert into company_cashback_rewards(order_id,company_id,client_id,amount_minor,percent_bps)
    values(o.id,o.selected_company_id,o.client_id,cashback_amount,cashback_bps) returning id into cashback_id;
    update wallets set available_minor=available_minor+cashback_amount where owner_id=o.client_id returning * into w;
    insert into wallet_transactions(wallet_id,owner_id,order_id,type,amount_minor,balance_after_minor,description)
    values(w.id,o.client_id,o.id,'adjustment',cashback_amount,w.available_minor,'Кешбэк от клининговой компании');
    insert into notifications(user_id,order_id,type,title,body,data)
    values(o.client_id,o.id,'company_cashback','Начислен кешбэк','Компания начислила кешбэк за завершённый заказ',jsonb_build_object('amount_minor',cashback_amount,'percent_bps',cashback_bps));
  end if;
end; $$;
revoke all on function public.finalize_order_finances(uuid) from public,anon,authenticated;

create or replace function public.get_my_company_report()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare uid uuid:=auth.uid(); company_uuid uuid; result jsonb;
begin
  select id into company_uuid from company_profiles where owner_id=uid;
  if company_uuid is null then raise exception 'Company profile not found'; end if;
  select jsonb_build_object(
    'company_code',(select company_code from company_profiles where id=company_uuid),
    'verification_status',(select verification_status from company_profiles where id=company_uuid),
    'cashback_bps',(select cashback_bps from company_profiles where id=company_uuid),
    'cashback_paid_minor',(select coalesce(sum(amount_minor),0) from company_cashback_rewards where company_id=company_uuid),
    'clients',(select count(*) from client_profiles where preferred_company_id=company_uuid),
    'orders_total',(select count(*) from orders where selected_company_id=company_uuid),
    'orders_active',(select count(*) from orders where selected_company_id=company_uuid and status not in ('completed','cancelled')),
    'orders_completed',(select count(*) from orders where selected_company_id=company_uuid and status='completed'),
    'revenue_minor',(select coalesce(sum(executor_amount_minor),0) from orders where selected_company_id=company_uuid and status='completed'),
    'rating',(select rating from company_profiles where id=company_uuid),
    'reviews_count',(select reviews_count from company_profiles where id=company_uuid)
  ) into result;
  return result;
end; $$;
grant execute on function public.get_my_company_report() to authenticated;
