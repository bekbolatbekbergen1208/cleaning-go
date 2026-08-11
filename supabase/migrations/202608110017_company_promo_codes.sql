-- Company promo codes: one stable code per company and a configurable client bonus.
alter table public.orders
  add column if not exists company_cashback_bps_snapshot integer not null default 0
  check (company_cashback_bps_snapshot between 0 and 2000);

create or replace function public.apply_company_promo_code(input_code text)
returns public.company_profiles
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result public.company_profiles; locked boolean;
begin
  if uid is null or not exists(select 1 from public.profiles where id=uid and role='client' and status='active') then
    raise exception 'Only active clients can apply a promo code';
  end if;
  select company_locked into locked from public.client_profiles where user_id=uid for update;
  if locked then raise exception 'A company promo code has already been applied'; end if;
  select * into result from public.company_profiles
    where company_code=upper(trim(input_code)) and verification_status='approved';
  if not found then raise exception 'Promo code is invalid or the company is not approved'; end if;
  update public.client_profiles set preferred_company_id=result.id,company_locked=true where user_id=uid;
  insert into public.notifications(user_id,type,title,body,data)
  values(uid,'company_promo','Промокод активирован','Вам доступен бонус компании',jsonb_build_object('company_id',result.id,'cashback_bps',result.cashback_bps));
  return result;
end; $$;
grant execute on function public.apply_company_promo_code(text) to authenticated;

create or replace function public.snapshot_order_fees() returns trigger
language plpgsql security definer set search_path=public as $$
declare cfg public.platform_settings; promo_bps integer:=0;
begin
  select * into cfg from public.platform_settings where id=true;
  if new.selected_company_id is not null and exists(
    select 1 from public.client_profiles cp where cp.user_id=new.client_id and cp.company_locked and cp.preferred_company_id=new.selected_company_id
  ) then select cashback_bps into promo_bps from public.company_profiles where id=new.selected_company_id; end if;
  new.platform_fee_bps_snapshot:=cfg.platform_fee_bps;
  new.referral_fee_bps_snapshot:=cfg.referral_fee_bps;
  new.company_cashback_bps_snapshot:=coalesce(promo_bps,0);
  return new;
end; $$;

create or replace function public.finalize_order_finances(target_order_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare o public.orders; ref public.referrals; reward_amount bigint:=0; cashback_amount bigint:=0;
  platform_amount bigint; executor_amount bigint; w public.wallets; cashback_id uuid;
begin
  select * into o from public.orders where id=target_order_id for update;
  if not found or o.status<>'completed' or o.payment_status<>'paid' then raise exception 'A paid completed order is required'; end if;
  if o.platform_fee_minor>0 or o.executor_amount_minor>0 then return; end if;

  select * into ref from public.referrals where referred_user_id=o.client_id;
  if found and not exists(select 1 from public.referral_rewards where referred_user_id=o.client_id) then
    reward_amount:=round(o.total_minor*o.referral_fee_bps_snapshot/10000.0);
  end if;
  if o.company_cashback_bps_snapshot>0 and not exists(select 1 from public.company_cashback_rewards where order_id=o.id) then
    cashback_amount:=round(o.total_minor*o.company_cashback_bps_snapshot/10000.0);
  end if;
  platform_amount:=round(o.total_minor*o.platform_fee_bps_snapshot/10000.0);
  executor_amount:=o.total_minor-platform_amount-reward_amount-cashback_amount;
  if executor_amount<0 then raise exception 'Invalid fee snapshots'; end if;
  update public.orders set platform_fee_minor=platform_amount,referral_reward_minor=reward_amount,
    company_cashback_minor=cashback_amount,executor_amount_minor=executor_amount where id=o.id;

  if reward_amount>0 then
    insert into public.referral_rewards(referral_id,order_id,beneficiary_id,referred_user_id,amount_minor,percent_bps)
    values(ref.id,o.id,ref.referrer_id,o.client_id,reward_amount,o.referral_fee_bps_snapshot) on conflict(order_id) do nothing;
    update public.wallets set available_minor=available_minor+reward_amount where owner_id=ref.referrer_id returning * into w;
    insert into public.wallet_transactions(wallet_id,owner_id,order_id,reward_id,type,amount_minor,balance_after_minor,description)
    select w.id,w.owner_id,o.id,r.id,'referral_reward',reward_amount,w.available_minor,'Награда за первый завершённый заказ' from public.referral_rewards r where r.order_id=o.id on conflict do nothing;
  end if;
  if cashback_amount>0 then
    insert into public.company_cashback_rewards(order_id,company_id,client_id,amount_minor,percent_bps)
    values(o.id,o.selected_company_id,o.client_id,cashback_amount,o.company_cashback_bps_snapshot)
    on conflict(order_id) do nothing returning id into cashback_id;
    if cashback_id is not null then
      update public.wallets set available_minor=available_minor+cashback_amount where owner_id=o.client_id returning * into w;
      insert into public.wallet_transactions(wallet_id,owner_id,order_id,type,amount_minor,balance_after_minor,description)
      values(w.id,o.client_id,o.id,'adjustment',cashback_amount,w.available_minor,'Бонус по промокоду компании');
      insert into public.notifications(user_id,order_id,type,title,body,data)
      values(o.client_id,o.id,'company_cashback','Начислен бонус','Компания начислила бонус за завершённый заказ',jsonb_build_object('amount_minor',cashback_amount,'percent_bps',o.company_cashback_bps_snapshot));
    end if;
  end if;
end; $$;
revoke all on function public.finalize_order_finances(uuid) from public,anon,authenticated;
