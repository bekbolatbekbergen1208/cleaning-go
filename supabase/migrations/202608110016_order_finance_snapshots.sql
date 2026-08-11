-- Freeze commercial settings per order and make completion accounting idempotent.
alter table public.orders
  add column if not exists platform_fee_bps_snapshot integer,
  add column if not exists referral_fee_bps_snapshot integer;

update public.orders o
set platform_fee_bps_snapshot = coalesce(o.platform_fee_bps_snapshot, s.platform_fee_bps),
    referral_fee_bps_snapshot = coalesce(o.referral_fee_bps_snapshot, s.referral_fee_bps)
from public.platform_settings s
where s.id = true
  and (o.platform_fee_bps_snapshot is null or o.referral_fee_bps_snapshot is null);

alter table public.orders
  alter column platform_fee_bps_snapshot set default 1000,
  alter column referral_fee_bps_snapshot set default 500,
  alter column platform_fee_bps_snapshot set not null,
  alter column referral_fee_bps_snapshot set not null,
  add constraint orders_platform_fee_snapshot_check check (platform_fee_bps_snapshot between 0 and 10000),
  add constraint orders_referral_fee_snapshot_check check (referral_fee_bps_snapshot between 0 and 10000);

create unique index if not exists wallet_transactions_one_order_income
  on public.wallet_transactions(order_id, type) where type = 'order_income';
create unique index if not exists wallet_transactions_one_platform_fee
  on public.wallet_transactions(order_id, type) where type = 'platform_fee';

create or replace function public.snapshot_order_fees() returns trigger
language plpgsql security definer set search_path=public as $$
declare cfg public.platform_settings;
begin
  select * into cfg from public.platform_settings where id = true;
  new.platform_fee_bps_snapshot := cfg.platform_fee_bps;
  new.referral_fee_bps_snapshot := cfg.referral_fee_bps;
  return new;
end; $$;

drop trigger if exists snapshot_order_fees_before_insert on public.orders;
create trigger snapshot_order_fees_before_insert before insert on public.orders
for each row execute function public.snapshot_order_fees();

create or replace function public.finalize_order_finances(target_order_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare o public.orders; ref public.referrals; reward_amount bigint := 0; platform_amount bigint; executor_amount bigint; w public.wallets;
begin
  select * into o from public.orders where id = target_order_id for update;
  if not found or o.status <> 'completed' or o.payment_status <> 'paid' then
    raise exception 'A paid completed order is required';
  end if;
  if o.platform_fee_minor > 0 or o.executor_amount_minor > 0 then return; end if;

  select * into ref from public.referrals where referred_user_id = o.client_id;
  if found and not exists(select 1 from public.referral_rewards where referred_user_id = o.client_id) then
    reward_amount := round(o.total_minor * o.referral_fee_bps_snapshot / 10000.0);
  end if;
  platform_amount := round(o.total_minor * o.platform_fee_bps_snapshot / 10000.0);
  executor_amount := o.total_minor - platform_amount - reward_amount;
  if executor_amount < 0 then raise exception 'Invalid fee snapshots'; end if;

  update public.orders set platform_fee_minor=platform_amount, referral_reward_minor=reward_amount,
    executor_amount_minor=executor_amount where id=o.id;
  if reward_amount > 0 then
    insert into public.referral_rewards(referral_id,order_id,beneficiary_id,referred_user_id,amount_minor,percent_bps)
    values(ref.id,o.id,ref.referrer_id,o.client_id,reward_amount,o.referral_fee_bps_snapshot)
    on conflict(order_id) do nothing;
    update public.wallets set available_minor=available_minor+reward_amount where owner_id=ref.referrer_id returning * into w;
    insert into public.wallet_transactions(wallet_id,owner_id,order_id,reward_id,type,amount_minor,balance_after_minor,description)
    select w.id,w.owner_id,o.id,r.id,'referral_reward',reward_amount,w.available_minor,'Награда за первый завершённый заказ' from public.referral_rewards r where r.order_id=o.id
    on conflict do nothing;
    insert into public.notifications(user_id,order_id,type,title,body,data)
    values(ref.referrer_id,o.id,'referral_reward','Начислена награда','Реферальное вознаграждение доступно',jsonb_build_object('amount_minor',reward_amount));
  end if;
end; $$;

revoke all on function public.finalize_order_finances(uuid) from public, anon, authenticated;

create or replace function public.transition_order_status(target_order_id uuid,next_status public.order_status,note text default null) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); o public.orders; assigned boolean; allowed boolean:=false; previous_status public.order_status;
begin
  select * into o from public.orders where id=target_order_id for update;
  if not found or not public.is_order_participant(target_order_id,uid) then raise exception 'Order unavailable'; end if;
  previous_status:=o.status;
  select exists(select 1 from public.order_workers where order_id=o.id and cleaner_id=uid)
    or exists(select 1 from public.order_assignments where order_id=o.id and is_active and (cleaner_id=uid or exists(select 1 from public.company_profiles where id=company_id and owner_id=uid))) into assigned;
  allowed:=public.is_admin(uid)
    or (uid=o.client_id and ((o.status='created' and next_status='cancelled') or (o.status='searching' and next_status='cancelled') or (o.status='completed_by_cleaner' and next_status='completed') or next_status='disputed'))
    or (assigned and ((o.status='accepted' and next_status='on_the_way') or (o.status='on_the_way' and next_status='arrived') or (o.status='arrived' and next_status='in_progress') or (o.status='in_progress' and next_status='completed_by_cleaner') or next_status='disputed'));
  if not allowed then raise exception 'Status transition is not allowed'; end if;

  update public.orders set status=next_status,
    payment_status=case when next_status='completed' and payment_method in ('cash','test') then 'paid' else payment_status end,
    completed_at=case when next_status='completed' then now() else completed_at end,
    cancelled_at=case when next_status='cancelled' then now() else cancelled_at end
  where id=o.id returning * into o;
  insert into public.order_status_history(order_id,from_status,to_status,changed_by,note) values(o.id,previous_status,next_status,uid,note);
  if next_status='completed' then perform public.finalize_order_finances(o.id); end if;
  if next_status in ('completed','cancelled') then delete from public.cleaner_locations where order_id=o.id; end if;
  insert into public.notifications(user_id,order_id,type,title,body) select o.client_id,o.id,'order_status','Статус заказа изменён','Новый статус: '||next_status where o.client_id<>uid;
  return o;
end; $$;

grant execute on function public.transition_order_status(uuid,public.order_status,text) to authenticated;
