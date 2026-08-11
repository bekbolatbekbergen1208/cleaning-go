-- A welcome credit belongs to one client+company pair and cannot be withdrawn or used elsewhere.
alter table public.company_profiles add column if not exists welcome_bonus_minor bigint not null default 200000
  check(welcome_bonus_minor between 0 and 1000000);
alter table public.orders add column if not exists company_bonus_used_minor bigint not null default 0 check(company_bonus_used_minor>=0);

create table if not exists public.company_bonus_balances(
  client_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.company_profiles(id) on delete cascade,
  balance_minor bigint not null default 0 check(balance_minor>=0),
  granted_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(client_id,company_id)
);
create table if not exists public.company_bonus_ledger(
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.profiles(id),
  company_id uuid not null references public.company_profiles(id), order_id uuid references public.orders(id),
  operation text not null check(operation in ('welcome_grant','order_use','order_refund')),
  amount_minor bigint not null check(amount_minor>0), created_at timestamptz not null default now()
);
create unique index if not exists one_company_welcome_grant on public.company_bonus_ledger(client_id,company_id) where operation='welcome_grant';
create unique index if not exists one_company_bonus_use on public.company_bonus_ledger(order_id) where operation='order_use';
create unique index if not exists one_company_bonus_refund on public.company_bonus_ledger(order_id) where operation='order_refund';

alter table public.company_bonus_balances enable row level security;
alter table public.company_bonus_ledger enable row level security;
create policy company_bonus_balance_parties on public.company_bonus_balances for select to authenticated using(
  client_id=auth.uid() or public.is_admin() or exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid()));
create policy company_bonus_ledger_parties on public.company_bonus_ledger for select to authenticated using(
  client_id=auth.uid() or public.is_admin() or exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid()));
grant select on public.company_bonus_balances,public.company_bonus_ledger to authenticated;

create or replace function public.grant_company_welcome_bonus(target_client uuid,target_company uuid) returns bigint
language plpgsql security definer set search_path=public as $$
declare amount bigint; inserted_id uuid;
begin
  select welcome_bonus_minor into amount from public.company_profiles where id=target_company;
  if coalesce(amount,0)=0 then return 0; end if;
  insert into public.company_bonus_ledger(client_id,company_id,operation,amount_minor)
  values(target_client,target_company,'welcome_grant',amount) on conflict do nothing returning id into inserted_id;
  if inserted_id is not null then
    insert into public.company_bonus_balances(client_id,company_id,balance_minor) values(target_client,target_company,amount)
    on conflict(client_id,company_id) do update set balance_minor=public.company_bonus_balances.balance_minor+excluded.balance_minor,updated_at=now();
  end if;
  return case when inserted_id is null then 0 else amount end;
end; $$;
revoke all on function public.grant_company_welcome_bonus(uuid,uuid) from public,anon,authenticated;

create or replace function public.apply_company_promo_code(input_code text) returns public.company_profiles
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result public.company_profiles; locked boolean; granted bigint;
begin
  if uid is null or not exists(select 1 from public.profiles where id=uid and role='client' and status='active') then raise exception 'Only active clients can apply a promo code'; end if;
  select company_locked into locked from public.client_profiles where user_id=uid for update;
  if locked then raise exception 'A company promo code has already been applied'; end if;
  select * into result from public.company_profiles where company_code=upper(trim(input_code)) and verification_status='approved';
  if not found then raise exception 'Promo code is invalid or the company is not approved'; end if;
  update public.client_profiles set preferred_company_id=result.id,company_locked=true where user_id=uid;
  granted:=public.grant_company_welcome_bonus(uid,result.id);
  insert into public.notifications(user_id,type,title,body,data) values(uid,'company_promo','Промокод активирован','Вам начисен бонус компании',jsonb_build_object('company_id',result.id,'bonus_minor',granted));
  return result;
end; $$;
grant execute on function public.apply_company_promo_code(text) to authenticated;

create or replace function public.choose_company(target_company_id uuid) returns public.company_profiles
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result public.company_profiles; granted bigint;
begin
  if uid is null or not exists(select 1 from public.profiles where id=uid and role='client' and status='active') then raise exception 'Only active clients can choose a company'; end if;
  select * into result from public.company_profiles where id=target_company_id and verification_status='approved';
  if not found then raise exception 'Company is unavailable'; end if;
  update public.client_profiles set preferred_company_id=result.id where user_id=uid;
  granted:=public.grant_company_welcome_bonus(uid,result.id);
  if granted>0 then insert into public.notifications(user_id,type,title,body,data) values(uid,'company_bonus','Бонус компании','Бонус доступен для заказа у выбранной компании',jsonb_build_object('company_id',result.id,'bonus_minor',granted)); end if;
  return result;
end; $$;
grant execute on function public.choose_company(uuid) to authenticated;

create or replace function public.set_company_order_price(target_order_id uuid,target_total_minor bigint) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result public.orders; available bigint:=0; used bigint:=0; previous_used bigint:=0;
begin
  if target_total_minor<10000 then raise exception 'Price must be at least 100 KZT'; end if;
  select o.* into result from public.orders o join public.company_profiles c on c.id=o.selected_company_id
  where o.id=target_order_id and c.owner_id=uid and o.status in ('searching','offered') for update of o;
  if not found then raise exception 'Order is unavailable for this company'; end if;
  previous_used:=result.company_bonus_used_minor;
  if previous_used>0 then
    update public.company_bonus_balances set balance_minor=balance_minor+previous_used,updated_at=now()
      where client_id=result.client_id and company_id=result.selected_company_id;
  end if;
  select balance_minor into available from public.company_bonus_balances
    where client_id=result.client_id and company_id=result.selected_company_id for update;
  used:=least(coalesce(available,0),target_total_minor);
  if used>0 then
    update public.company_bonus_balances set balance_minor=balance_minor-used,updated_at=now()
      where client_id=result.client_id and company_id=result.selected_company_id;
    insert into public.company_bonus_ledger(client_id,company_id,order_id,operation,amount_minor)
      values(result.client_id,result.selected_company_id,result.id,'order_use',used)
      on conflict(order_id) where operation='order_use' do update set amount_minor=excluded.amount_minor;
  end if;
  update public.orders set subtotal_minor=target_total_minor,total_minor=target_total_minor-used,company_bonus_used_minor=used,
    price_confirmed_at=now(),price_confirmed_by=uid where id=target_order_id returning * into result;
  update public.order_items set unit_price_minor=target_total_minor,total_minor=target_total_minor where order_id=target_order_id and service_option_id is null;
  insert into public.notifications(user_id,order_id,type,title,body,data)
  values(result.client_id,result.id,'company_price','Компания указала цену','К оплате: '||(result.total_minor/100)::text||' ₸',jsonb_build_object('subtotal_minor',target_total_minor,'company_bonus_used_minor',used,'total_minor',result.total_minor));
  return result;
end; $$;
grant execute on function public.set_company_order_price(uuid,bigint) to authenticated;

create or replace function public.restore_company_bonus_on_cancel() returns trigger language plpgsql security definer set search_path=public as $$
declare inserted_id uuid;
begin
  if new.status='cancelled' and old.status is distinct from 'cancelled' and new.company_bonus_used_minor>0 then
    insert into public.company_bonus_ledger(client_id,company_id,order_id,operation,amount_minor)
    values(new.client_id,new.selected_company_id,new.id,'order_refund',new.company_bonus_used_minor)
    on conflict do nothing returning id into inserted_id;
    if inserted_id is not null then update public.company_bonus_balances set balance_minor=balance_minor+new.company_bonus_used_minor,updated_at=now()
      where client_id=new.client_id and company_id=new.selected_company_id; end if;
  end if;
  return new;
end; $$;
drop trigger if exists restore_company_bonus_after_cancel on public.orders;
create trigger restore_company_bonus_after_cancel after update of status on public.orders for each row execute function public.restore_company_bonus_on_cancel();

create or replace function public.set_my_company_welcome_bonus(target_minor bigint) returns bigint
language plpgsql security definer set search_path=public as $$
begin
  if target_minor not between 0 and 1000000 then raise exception 'Welcome bonus must be between 0 and 10000 KZT'; end if;
  update public.company_profiles set welcome_bonus_minor=target_minor where owner_id=auth.uid();
  if not found then raise exception 'Company profile not found'; end if;
  return target_minor;
end; $$;
grant execute on function public.set_my_company_welcome_bonus(bigint) to authenticated;
