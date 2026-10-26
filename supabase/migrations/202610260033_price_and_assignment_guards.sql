-- Keep mobile RPC pricing above the service floor and give cleaners a nonzero payout.
create or replace function public.set_company_order_price(target_order_id uuid,target_total_minor bigint) returns orders
language plpgsql security definer set search_path=public as $$
declare result orders; available bigint:=0; used bigint:=0; previous_used bigint:=0; debit_id uuid;
begin
  if target_total_minor<10000 then raise exception 'Price must be at least 100 KZT'; end if;
  select o.* into result from orders o join company_profiles c on c.id=o.selected_company_id
    where o.id=target_order_id and c.owner_id=auth.uid() and o.status in ('searching','offered') for update of o;
  if not found then raise exception 'Order is unavailable for this company'; end if;
  if target_total_minor < (select base_price_minor from cleaning_services where id=result.service_id) then raise exception 'Price is below the service base price'; end if;
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
  update orders set subtotal_minor=target_total_minor,total_minor=target_total_minor-used,company_bonus_used_minor=used,executor_amount_minor=greatest(coalesce(executor_amount_minor,0),required_workers*100,target_total_minor/2),price_confirmed_at=now(),price_confirmed_by=auth.uid() where id=target_order_id returning * into result;
  update order_items set unit_price_minor=target_total_minor,total_minor=target_total_minor where order_id=target_order_id and service_option_id is null;
  insert into notifications(user_id,order_id,type,title,body,data) values(result.client_id,result.id,'company_price','Компания указала цену','К оплате: '||(result.total_minor/100)::text||' ₸',jsonb_build_object('subtotal_minor',target_total_minor,'company_bonus_used_minor',used,'total_minor',result.total_minor));
  return result;
end; $$;
grant execute on function public.set_company_order_price(uuid,bigint) to authenticated;

create or replace function public.set_company_order_price(target_order_id uuid,target_total_minor bigint,target_required_workers integer) returns orders
language plpgsql security definer set search_path=public as $$
declare result orders;
begin
  if target_required_workers not between 1 and 50 then raise exception 'Required workers must be between 1 and 100'; end if;
  result:=public.set_company_order_price(target_order_id,target_total_minor);
  update orders set required_workers=target_required_workers,executor_amount_minor=greatest(coalesce(executor_amount_minor,0),target_required_workers*100) where id=target_order_id returning * into result;
  return result;
end; $$;
grant execute on function public.set_company_order_price(uuid,bigint,integer) to authenticated;

-- Directly accepting a cleaner order requires an active shift, including through RPC.
create or replace function public.require_active_cleaner_shift_for_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.cleaner_id is not null and not exists (
    select 1 from cleaner_profiles cp where cp.user_id=new.cleaner_id
      and cp.verification_status='approved' and cp.is_available and cp.workday_ends_at>now()
  ) then raise exception 'Start an active workday before accepting an order'; end if;
  return new;
end; $$;
drop trigger if exists require_active_cleaner_shift_for_assignment on public.order_assignments;
create trigger require_active_cleaner_shift_for_assignment before insert on public.order_assignments
for each row execute function public.require_active_cleaner_shift_for_assignment();
