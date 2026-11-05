alter table public.orders add column finances_finalized_at timestamptz;
create or replace function public.finalize_order_finances(target_order_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare o public.orders; ref public.referrals; reward_amount bigint:=0; cashback_amount bigint:=0;
  platform_amount bigint; executor_amount bigint; w public.wallets; cashback_id uuid;
begin
  select * into o from public.orders where id=target_order_id for update;
  if not found or o.status<>'completed' or o.payment_status<>'paid' then raise exception 'A paid completed order is required'; end if;
  if o.finances_finalized_at is not null then return; end if;

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
  if o.selected_company_id is not null and o.executor_amount_minor>0 then executor_amount:=o.executor_amount_minor; end if;
  update public.orders set finances_finalized_at=now(),platform_fee_minor=platform_amount,referral_reward_minor=reward_amount,
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
    or (uid=o.client_id and ((o.status='created' and next_status='cancelled') or (o.status in ('searching','offered') and next_status='cancelled') or (o.status='completed_by_cleaner' and next_status='completed') or (next_status='disputed' and o.status not in ('cancelled','disputed'))))
    or (assigned and ((o.status='accepted' and next_status='on_the_way') or (o.status='on_the_way' and next_status='arrived') or (o.status='arrived' and next_status='in_progress') or (o.status='in_progress' and next_status='completed_by_cleaner') or (next_status='disputed' and o.status not in ('cancelled','disputed'))));
  if not allowed then raise exception 'Status transition is not allowed'; end if;

  update public.orders set status=next_status,
    payment_status=case when next_status='completed' and payment_method in ('cash','test') then 'paid' else payment_status end,
    completed_at=case when next_status='completed' then now() else completed_at end,
    cancelled_at=case when next_status='cancelled' then now() else cancelled_at end
  where id=o.id returning * into o;
  insert into public.order_status_history(order_id,from_status,to_status,changed_by,note) values(o.id,previous_status,next_status,uid,note);
  if next_status='completed' and o.payment_status='paid' then perform public.finalize_order_finances(o.id); select * into o from public.orders where id=o.id; end if;
  if next_status in ('completed','cancelled') then delete from public.cleaner_locations where order_id=o.id; end if;
  insert into public.notifications(user_id,order_id,type,title,body) select o.client_id,o.id,'order_status','Статус заказа изменён','Новый статус: '||next_status where o.client_id<>uid;
  return o;
end; $$;

grant execute on function public.transition_order_status(uuid,public.order_status,text) to authenticated;


create function public.validate_local_order_insert() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then return new; end if;
 if new.scheduled_at<=now() then raise exception 'Choose a future order time'; end if;
 if exists(select 1 from unnest(new.photo_urls) path where split_part(path,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects s where s.bucket_id='order-photos' and s.name=path)) then raise exception 'Upload your own room photos before creating the order'; end if;
 return new;
end; $$;
create trigger validate_local_order_insert before insert on public.orders for each row execute function public.validate_local_order_insert();
create function public.refund_cancelled_company_bonus() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='cancelled' and old.status<>'cancelled' and old.company_bonus_used_minor>0 then
  perform public.add_company_bonus(old.client_id,old.selected_company_id,'order_refund',old.company_bonus_used_minor,null,old.id,'Возврат бонусов отменённого заказа');
 end if;
 return new;
end; $$;
create trigger refund_cancelled_company_bonus after update of status on public.orders for each row execute function public.refund_cancelled_company_bonus();
