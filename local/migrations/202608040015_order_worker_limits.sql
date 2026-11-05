drop trigger if exists enforce_company_employee_limit on public.company_cleaners;

alter table public.orders add column if not exists required_workers integer not null default 1 check(required_workers between 1 and 50);

create table if not exists public.order_workers(
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  cleaner_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique(order_id,cleaner_id)
);
create index if not exists order_workers_cleaner_idx on public.order_workers(cleaner_id,joined_at desc);
alter table public.order_workers enable row level security;
drop policy if exists order_workers_participant_read on public.order_workers;
create policy order_workers_participant_read on public.order_workers for select to authenticated using(
  cleaner_id=auth.uid() or public.is_admin() or public.is_order_participant(order_id)
);
grant select on public.order_workers to authenticated;

drop function if exists public.set_company_order_price(uuid,bigint);
create function public.set_company_order_price(target_order_id uuid,target_total_minor bigint,target_required_workers integer)
returns public.orders language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result orders;
begin
  if target_total_minor<10000 then raise exception 'Price must be at least 100 KZT'; end if;
  if target_required_workers not between 1 and 50 then raise exception 'Workers count must be between 1 and 50'; end if;
  select o.* into result from orders o join company_profiles c on c.id=o.selected_company_id
  where o.id=target_order_id and c.owner_id=uid and o.status in ('searching','offered') for update of o;
  if not found then raise exception 'Order is unavailable for this company'; end if;
  update orders set subtotal_minor=target_total_minor,total_minor=target_total_minor,required_workers=target_required_workers,
    price_confirmed_at=now(),price_confirmed_by=uid where id=target_order_id returning * into result;
  update order_items set unit_price_minor=target_total_minor,total_minor=target_total_minor where order_id=target_order_id and service_option_id is null;
  insert into notifications(user_id,order_id,type,title,body,data)
  values(result.client_id,result.id,'company_price','Компания указала цену','Цена и состав команды подтверждены',jsonb_build_object('total_minor',target_total_minor,'required_workers',target_required_workers));
  return result;
end; $$;
grant execute on function public.set_company_order_price(uuid,bigint,integer) to authenticated;

create or replace function public.claim_company_order(target_order_id uuid) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); company_uuid uuid; result orders; current_workers integer;
begin
  select cc.company_id into company_uuid from company_cleaners cc
  where cc.cleaner_id=uid and cc.is_active and exists(select 1 from cleaner_profiles cp where cp.user_id=uid and cp.verification_status='approved');
  if company_uuid is null then raise exception 'Approved company employee profile required'; end if;
  select * into result from orders where id=target_order_id and selected_company_id=company_uuid and status='accepted' for update;
  if not found then raise exception 'Company order is unavailable'; end if;
  if exists(select 1 from order_workers where order_id=target_order_id and cleaner_id=uid) then return result; end if;
  select count(*) into current_workers from order_workers where order_id=target_order_id;
  if current_workers>=result.required_workers then raise exception 'All employee places for this order are already filled'; end if;
  insert into order_workers(order_id,cleaner_id) values(target_order_id,uid);
  insert into notifications(user_id,order_id,type,title,body) values(result.client_id,result.id,'employee_assigned','Сотрудник присоединился','Сотрудник компании присоединился к вашему заказу');
  return result;
end; $$;
grant execute on function public.claim_company_order(uuid) to authenticated;

create or replace function public.is_order_participant(target_order_id uuid,uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select public.is_admin(uid)
 or exists(select 1 from orders o where o.id=target_order_id and o.client_id=uid)
 or exists(select 1 from orders o join company_profiles c on c.id=o.selected_company_id where o.id=target_order_id and c.owner_id=uid)
 or exists(select 1 from order_workers w where w.order_id=target_order_id and w.cleaner_id=uid)
 or exists(select 1 from order_assignments a where a.order_id=target_order_id and a.is_active and (a.cleaner_id=uid or exists(select 1 from company_profiles c where c.id=a.company_id and c.owner_id=uid)));
$$;

create or replace function public.transition_order_status(target_order_id uuid,next_status public.order_status,note text default null) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); o orders; assigned boolean; allowed boolean:=false; previous_status order_status;
begin
  select * into o from orders where id=target_order_id for update;
  if not found or not is_order_participant(target_order_id,uid) then raise exception 'Order unavailable'; end if;
  previous_status:=o.status;
  select exists(select 1 from order_workers where order_id=o.id and cleaner_id=uid)
    or exists(select 1 from order_assignments where order_id=o.id and is_active and (cleaner_id=uid or exists(select 1 from company_profiles where id=company_id and owner_id=uid))) into assigned;
  allowed:=is_admin(uid)
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
grant execute on function public.transition_order_status(uuid,public.order_status,text) to authenticated;

