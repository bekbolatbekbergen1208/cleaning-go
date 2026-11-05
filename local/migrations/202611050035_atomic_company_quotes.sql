-- Company quotes must be confirmed by the client; web and native share transactions.
create function public.propose_company_order_price(target_order_id uuid,target_total_minor bigint,target_required_workers integer,target_cleaner_amount_minor bigint)
returns public.orders language plpgsql security definer set search_path=public as $$
declare o orders; previous order_status;
begin
  select x.* into o from orders x join company_profiles c on c.id=x.selected_company_id join profiles p on p.id=c.owner_id
  where x.id=target_order_id and c.owner_id=auth.uid() and p.status='active' and c.verification_status='approved'
  and x.status in ('searching','offered') and x.price_confirmed_at is null for update of x;
  if not found then raise exception 'Order is unavailable for this company'; end if;
  if target_total_minor is null or target_total_minor<(select base_price_minor from cleaning_services where id=o.service_id)
    then raise exception 'Price is below the service base price'; end if;
  if target_required_workers is null or target_required_workers not between 1 and 50 then raise exception 'Required workers must be between 1 and 50'; end if;
  if target_cleaner_amount_minor is null or target_cleaner_amount_minor<target_required_workers*100 or target_cleaner_amount_minor>target_total_minor then raise exception 'Invalid cleaner payout'; end if;
  if not exists(select 1 from community_companies cc join cleaner_communities c on c.id=cc.community_id and c.is_active where cc.company_id=o.selected_company_id) then raise exception 'An active cleaner community is required'; end if;
  previous:=o.status;
  update orders set subtotal_minor=target_total_minor,total_minor=target_total_minor,required_workers=target_required_workers,
    executor_amount_minor=target_cleaner_amount_minor,status='offered' where id=o.id returning * into o;
  update order_items set unit_price_minor=target_total_minor,total_minor=target_total_minor where order_id=o.id and service_option_id is null;
  if previous<>'offered' then insert into order_status_history(order_id,from_status,to_status,changed_by) values(o.id,previous,'offered',auth.uid()); end if;
  insert into notifications(user_id,order_id,type,title,body) values(o.client_id,o.id,'company_price','Компания указала цену','Подтвердите цену заказа: '||(o.total_minor/100)::text||' ₸');
  return o;
end; $$;

create function public.confirm_company_order_price(target_order_id uuid) returns public.orders
language plpgsql security definer set search_path=public as $$
declare o orders; available bigint:=0; used bigint:=0; company_owner_id uuid;
begin
  select * into o from orders where id=target_order_id and client_id=auth.uid() for update;
  if not found or not exists(select 1 from profiles where id=auth.uid() and role='client' and status='active') then raise exception 'Order unavailable'; end if;
  if o.status='accepted' and o.price_confirmed_at is not null then return o; end if;
  if o.status<>'offered' or o.price_confirmed_at is not null or o.selected_company_id is null then raise exception 'Price is unavailable for confirmation'; end if;
  if not exists(select 1 from community_companies cc join cleaner_communities c on c.id=cc.community_id and c.is_active where cc.company_id=o.selected_company_id) then raise exception 'An active cleaner community is required'; end if;
  select owner_id into company_owner_id from company_profiles where id=o.selected_company_id and verification_status='approved';
  if not found then raise exception 'Company is unavailable'; end if;
  if o.total_minor<(select base_price_minor from cleaning_services where id=o.service_id) then raise exception 'Price is below the service base price'; end if;
  if o.requested_company_bonus_minor>0 and o.company_bonus_used_minor=0 then
    select balance_minor into available from company_bonus_balances where client_id=o.client_id and company_id=o.selected_company_id for update;
    used:=least(coalesce(available,0),o.total_minor,o.requested_company_bonus_minor);
    if used>0 then
      update company_bonus_balances set balance_minor=balance_minor-used,updated_at=now() where client_id=o.client_id and company_id=o.selected_company_id returning balance_minor into available;
      insert into company_bonus_ledger(client_id,company_id,order_id,operation,amount_minor,balance_after_minor,description)
      values(o.client_id,o.selected_company_id,o.id,'order_use',used,available,'Оплата заказа бонусами');
    end if;
  end if;
  insert into order_assignments(order_id,company_id,assigned_by,accepted_at) values(o.id,o.selected_company_id,auth.uid(),now());
  update orders set total_minor=total_minor-used,company_bonus_used_minor=company_bonus_used_minor+used,status='accepted',price_confirmed_at=now(),price_confirmed_by=auth.uid() where id=o.id returning * into o;
  insert into order_status_history(order_id,from_status,to_status,changed_by,note) values(o.id,'offered','accepted',auth.uid(),'Клиент подтвердил цену');
  insert into notifications(user_id,order_id,type,title,body) values(company_owner_id,o.id,'price_accepted','Клиент подтвердил цену','Заказ опубликован для клинеров');
  return o;
end; $$;
-- Older mobile clients can propose a price but cannot bypass client consent.
create or replace function public.set_company_order_price(target_order_id uuid,target_total_minor bigint,target_required_workers integer) returns orders
language sql security definer set search_path=public as $$ select public.propose_company_order_price(target_order_id,target_total_minor,target_required_workers,greatest(target_required_workers*100,target_total_minor/2)); $$;
create or replace function public.set_company_order_price(target_order_id uuid,target_total_minor bigint) returns orders
language sql security definer set search_path=public as $$ select public.set_company_order_price(target_order_id,target_total_minor,1); $$;
grant execute on function public.propose_company_order_price(uuid,bigint,integer,bigint),public.confirm_company_order_price(uuid) to authenticated;
