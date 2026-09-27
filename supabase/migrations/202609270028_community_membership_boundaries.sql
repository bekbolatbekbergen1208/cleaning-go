-- Companies retain their own clients; cleaners are shared only within a community.
-- Security-definer helpers avoid recursive policies between the membership tables.
create or replace function public.is_community_member(target_community uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.community_companies cc
    join public.company_profiles c on c.id = cc.company_id
    join public.profiles p on p.id = c.owner_id
    where cc.community_id = target_community and c.owner_id = auth.uid()
      and p.status = 'active' and p.role = 'company_owner'
  ) or exists (
    select 1 from public.community_cleaners cm
    join public.profiles p on p.id = cm.cleaner_id
    where cm.community_id = target_community and cm.cleaner_id = auth.uid()
      and p.status = 'active' and p.role in ('cleaner', 'company_cleaner')
  );
$$;
revoke all on function public.is_community_member(uuid) from public;
grant execute on function public.is_community_member(uuid) to authenticated;

drop policy if exists communities_member_read on public.cleaner_communities;
create policy communities_member_read on public.cleaner_communities for select to authenticated
using (public.is_admin() or public.is_community_member(cleaner_communities.id));
drop policy if exists community_companies_member_read on public.community_companies;
create policy community_companies_member_read on public.community_companies for select to authenticated
using (public.is_admin() or public.is_community_member(community_companies.community_id));
drop policy if exists community_cleaners_member_read on public.community_cleaners;
create policy community_cleaners_member_read on public.community_cleaners for select to authenticated
using (public.is_admin() or public.is_community_member(community_cleaners.community_id));

-- This helper exposes only eligibility, never another company's client list.
create or replace function public.can_claim_community_company(target_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from community_companies cc
    join cleaner_communities community on community.id = cc.community_id and community.is_active
    join community_cleaners cm on cm.community_id = cc.community_id and cm.cleaner_id = auth.uid()
    join cleaner_profiles cp on cp.user_id = cm.cleaner_id
    join profiles p on p.id = cp.user_id
    where cc.company_id = target_company and cp.verification_status = 'approved'
      and cp.is_available and p.status = 'active' and p.role in ('cleaner', 'company_cleaner')
  );
$$;
revoke all on function public.can_claim_community_company(uuid) from public;
grant execute on function public.can_claim_community_company(uuid) to authenticated;

create or replace function public.claim_company_order(target_order_id uuid) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result orders; current_workers integer; company_owner_id uuid;
begin
  if not exists(select 1 from cleaner_profiles cp join profiles p on p.id=cp.user_id where cp.user_id=uid and cp.verification_status='approved' and cp.is_available and p.status='active') then raise exception 'Approved and available cleaner profile required'; end if;
  select o.* into result from orders o join community_companies company_member on company_member.company_id=o.selected_company_id join community_cleaners cleaner_member on cleaner_member.community_id=company_member.community_id and cleaner_member.cleaner_id=uid where o.id=target_order_id and o.status='accepted' and o.scheduled_at>now() and public.can_claim_community_company(o.selected_company_id) for update of o;
  if not found then raise exception 'Order is unavailable in your community'; end if;
  if exists(select 1 from order_workers where order_id=target_order_id and cleaner_id=uid) then return result; end if;
  select count(*) into current_workers from order_workers where order_id=target_order_id;
  if current_workers>=result.required_workers then raise exception 'All cleaner places are filled'; end if;
  insert into order_workers(order_id,cleaner_id) values(target_order_id,uid);
  select owner_id into company_owner_id from company_profiles where id=result.selected_company_id;
  insert into notifications(user_id,order_id,type,title,body) values(result.client_id,result.id,'cleaner_assigned','Клинер найден','Клинер из сообщества взял ваш заказ'),(company_owner_id,result.id,'cleaner_assigned','Клинер взял заказ','Участник вашего сообщества присоединился к заказу');
  return result;
end; $$;

revoke all on function public.claim_company_order(uuid) from public;
grant execute on function public.claim_company_order(uuid) to authenticated;

drop policy if exists orders_participants_read on public.orders;
create policy orders_participants_read on public.orders for select to authenticated using(
  client_id=auth.uid() or public.is_admin() or exists(select 1 from company_profiles c where c.id=orders.selected_company_id and c.owner_id=auth.uid()) or exists(select 1 from order_workers w where w.order_id=orders.id and w.cleaner_id=auth.uid()) or
  (status='accepted' and scheduled_at>now() and public.can_claim_community_company(orders.selected_company_id))
);

create or replace function public.notify_cleaner_community_after_publish() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='accepted' and old.status is distinct from 'accepted' and new.selected_company_id is not null then
    insert into notifications(user_id,order_id,type,title,body)
    select cm.cleaner_id,new.id,'community_order_available','Новый заказ в вашем сообществе','Откройте заказ и возьмите свободное место' from community_companies cc join cleaner_communities community on community.id=cc.community_id and community.is_active join community_cleaners cm on cm.community_id=cc.community_id join cleaner_profiles cp on cp.user_id=cm.cleaner_id join profiles p on p.id=cm.cleaner_id where cc.company_id=new.selected_company_id and cp.verification_status='approved' and cp.is_available and p.status='active';
  end if; return new;
end; $$;

create or replace function public.join_company_community(community_code text) returns public.cleaner_communities
language plpgsql security definer set search_path=public as $$
declare company_uuid uuid; result cleaner_communities;
begin
  select c.id into company_uuid from company_profiles c join profiles p on p.id=c.owner_id where c.owner_id=auth.uid() and c.verification_status='approved' and p.role='company_owner' and p.status='active';
  if company_uuid is null then raise exception 'Approved company required'; end if;
  select * into result from cleaner_communities where code=upper(trim(community_code)) and is_active for update;
  if not found then raise exception 'Community code is invalid'; end if;
  insert into community_companies(community_id,company_id) values(result.id,company_uuid)
  on conflict(company_id) do update set community_id=excluded.community_id,joined_at=now();
  return result;
end; $$;
grant execute on function public.join_company_community(text) to authenticated;


revoke all on function public.join_company_community(text) from public;

-- Existing cleaners can join by invitation; changing communities is not implicit.
create or replace function public.join_cleaner_community(community_code text)
returns public.cleaner_communities
language plpgsql security definer set search_path=public as $$
declare result cleaner_communities; current_community uuid;
begin
  perform 1 from profiles where id=auth.uid() and role in ('cleaner','company_cleaner') and status='active' for update;
  if not found then raise exception 'Active cleaner account required'; end if;
  if not exists(select 1 from cleaner_profiles where user_id=auth.uid()) then raise exception 'Cleaner profile required'; end if;
  select * into result from cleaner_communities where code=upper(trim(community_code)) and is_active for update;
  if not found then raise exception 'Community code is invalid'; end if;
  select community_id into current_community from community_cleaners where cleaner_id=auth.uid();
  if current_community is not null and current_community<>result.id then
    raise exception 'You already belong to a community. Contact the administrator';
  end if;
  insert into community_cleaners(community_id,cleaner_id) values(result.id,auth.uid()) on conflict(cleaner_id) do nothing;
  return result;
end; $$;
revoke all on function public.join_cleaner_community(text) from public;
grant execute on function public.join_cleaner_community(text) to authenticated;
