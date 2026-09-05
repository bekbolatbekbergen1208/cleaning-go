create table if not exists public.cleaner_communities(
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(trim(name)) between 2 and 120),
  code text not null unique check(code=upper(code) and char_length(code) between 4 and 32),
  description text,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.community_companies(
  community_id uuid not null references public.cleaner_communities(id) on delete cascade,
  company_id uuid primary key references public.company_profiles(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create table if not exists public.community_cleaners(
  community_id uuid not null references public.cleaner_communities(id) on delete cascade,
  cleaner_id uuid primary key references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index if not exists community_companies_community_idx on public.community_companies(community_id);
create index if not exists community_cleaners_community_idx on public.community_cleaners(community_id);
drop trigger if exists set_cleaner_communities_updated_at on public.cleaner_communities;
create trigger set_cleaner_communities_updated_at before update on public.cleaner_communities for each row execute function public.set_updated_at();

alter table public.cleaner_communities enable row level security;
alter table public.community_companies enable row level security;
alter table public.community_cleaners enable row level security;
create policy communities_member_read on public.cleaner_communities for select to authenticated using(
  public.is_admin() or exists(select 1 from community_companies cc join company_profiles c on c.id=cc.company_id where cc.community_id=id and c.owner_id=auth.uid())
  or exists(select 1 from community_cleaners cm where cm.community_id=id and cm.cleaner_id=auth.uid())
);
create policy communities_admin_all on public.cleaner_communities for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy community_companies_member_read on public.community_companies for select to authenticated using(public.is_admin() or exists(select 1 from company_profiles c where c.id=company_id and c.owner_id=auth.uid()) or exists(select 1 from community_cleaners cm where cm.community_id=community_id and cm.cleaner_id=auth.uid()));
create policy community_cleaners_member_read on public.community_cleaners for select to authenticated using(public.is_admin() or cleaner_id=auth.uid() or exists(select 1 from community_companies cc join company_profiles c on c.id=cc.company_id where cc.community_id=community_id and c.owner_id=auth.uid()));
grant select on public.cleaner_communities,public.community_companies,public.community_cleaners to authenticated;
grant insert,update,delete on public.cleaner_communities to authenticated;

create or replace function public.join_company_community(community_code text) returns public.cleaner_communities
language plpgsql security definer set search_path=public as $$
declare company_uuid uuid; result cleaner_communities;
begin
  select id into company_uuid from company_profiles where owner_id=auth.uid() and verification_status='approved';
  if company_uuid is null then raise exception 'Approved company required'; end if;
  select * into result from cleaner_communities where code=upper(trim(community_code)) and is_active for update;
  if not found then raise exception 'Community code is invalid'; end if;
  insert into community_companies(community_id,company_id) values(result.id,company_uuid)
  on conflict(company_id) do update set community_id=excluded.community_id,joined_at=now();
  return result;
end; $$;
grant execute on function public.join_company_community(text) to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
declare requested_role user_role; invite text; target_community uuid;
begin
  requested_role:=coalesce((new.raw_user_meta_data->>'role')::user_role,'client');
  if requested_role not in ('client','cleaner','company_owner') then requested_role:='client'; end if;
  invite:=upper(nullif(trim(new.raw_user_meta_data->>'referral_code'),''));
  if requested_role='cleaner' then
    select id into target_community from cleaner_communities where code=invite and is_active;
    if target_community is null then raise exception 'Valid community code is required'; end if;
  end if;
  insert into profiles(id,role,full_name,phone,email) values(new.id,requested_role,coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'Пользователь'),new.phone,new.email);
  insert into wallets(owner_id) values(new.id);
  insert into referral_codes(owner_id,code) select new.id,referral_code from profiles where id=new.id;
  if requested_role='client' then
    insert into client_profiles(user_id) values(new.id); if invite is not null then perform public.link_client_to_company(new.id,invite); end if;
  elsif requested_role='cleaner' then
    insert into cleaner_profiles(user_id) values(new.id);
    insert into community_cleaners(community_id,cleaner_id) values(target_community,new.id);
  else
    if nullif(trim(new.raw_user_meta_data->>'company_name'),'') is null or nullif(trim(new.raw_user_meta_data->>'company_registration_number'),'') is null or nullif(trim(new.raw_user_meta_data->>'company_address'),'') is null or nullif(trim(new.raw_user_meta_data->>'company_city'),'') is null or nullif(trim(new.raw_user_meta_data->>'company_phone'),'') is null then raise exception 'Company registration details are required'; end if;
    insert into company_profiles(owner_id,name,registration_number,address,service_cities,contact_phone,contact_email) values(new.id,trim(new.raw_user_meta_data->>'company_name'),trim(new.raw_user_meta_data->>'company_registration_number'),trim(new.raw_user_meta_data->>'company_address'),array[trim(new.raw_user_meta_data->>'company_city')],trim(new.raw_user_meta_data->>'company_phone'),new.email);
  end if; return new;
exception when invalid_text_representation then raise exception 'Unsupported registration role';
end; $$;

create or replace function public.claim_company_order(target_order_id uuid) returns public.orders
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result orders; current_workers integer; company_owner_id uuid;
begin
  if not exists(select 1 from cleaner_profiles cp join profiles p on p.id=cp.user_id where cp.user_id=uid and cp.verification_status='approved' and cp.is_available and p.status='active') then raise exception 'Approved and available cleaner profile required'; end if;
  select o.* into result from orders o join community_companies company_member on company_member.company_id=o.selected_company_id join community_cleaners cleaner_member on cleaner_member.community_id=company_member.community_id and cleaner_member.cleaner_id=uid where o.id=target_order_id and o.status='accepted' and o.scheduled_at>now() for update of o;
  if not found then raise exception 'Order is unavailable in your community'; end if;
  if exists(select 1 from order_workers where order_id=target_order_id and cleaner_id=uid) then return result; end if;
  select count(*) into current_workers from order_workers where order_id=target_order_id;
  if current_workers>=result.required_workers then raise exception 'All cleaner places are filled'; end if;
  insert into order_workers(order_id,cleaner_id) values(target_order_id,uid);
  select owner_id into company_owner_id from company_profiles where id=result.selected_company_id;
  insert into notifications(user_id,order_id,type,title,body) values(result.client_id,result.id,'cleaner_assigned','Клинер найден','Клинер из сообщества взял ваш заказ'),(company_owner_id,result.id,'cleaner_assigned','Клинер взял заказ','Участник вашего сообщества присоединился к заказу');
  return result;
end; $$;

drop policy if exists orders_participants_read on public.orders;
create policy orders_participants_read on public.orders for select to authenticated using(
  client_id=auth.uid() or public.is_admin() or exists(select 1 from company_profiles c where c.id=selected_company_id and c.owner_id=auth.uid()) or exists(select 1 from order_workers w where w.order_id=id and w.cleaner_id=auth.uid()) or
  (status='accepted' and scheduled_at>now() and exists(select 1 from community_companies cc join community_cleaners cm on cm.community_id=cc.community_id where cc.company_id=selected_company_id and cm.cleaner_id=auth.uid()) and exists(select 1 from cleaner_profiles cp where cp.user_id=auth.uid() and cp.verification_status='approved' and cp.is_available))
);

create or replace function public.notify_cleaner_community_after_publish() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='accepted' and old.status is distinct from 'accepted' and new.selected_company_id is not null then
    insert into notifications(user_id,order_id,type,title,body)
    select cm.cleaner_id,new.id,'community_order_available','Новый заказ в вашем сообществе','Откройте заказ и возьмите свободное место' from community_companies cc join community_cleaners cm on cm.community_id=cc.community_id join cleaner_profiles cp on cp.user_id=cm.cleaner_id join profiles p on p.id=cm.cleaner_id where cc.company_id=new.selected_company_id and cp.verification_status='approved' and cp.is_available and p.status='active';
  end if; return new;
end; $$;
