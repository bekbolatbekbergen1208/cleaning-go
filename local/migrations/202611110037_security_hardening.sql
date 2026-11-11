alter table auth.sessions add column is_recovery boolean not null default false;
-- Limit account discovery to the public executor directory and actual business relationships.
create function public.can_read_profile(target uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select target=auth.uid() or public.is_admin() or
    exists(select 1 from profiles p where p.id=target and p.status='active' and
      (p.role='company_owner' or exists(select 1 from cleaner_profiles cp where cp.user_id=p.id and cp.verification_status='approved'))) or
    exists(select 1 from client_profiles cp join company_profiles c on c.id=cp.preferred_company_id where cp.user_id=target and c.owner_id=auth.uid()) or
    exists(select 1 from orders o where o.client_id=target and public.is_order_participant(o.id)) or
    exists(select 1 from referrals r where (r.referrer_id=auth.uid() and r.referred_user_id=target) or (r.referred_user_id=auth.uid() and r.referrer_id=target));
$$;
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using(public.can_read_profile(id));

-- A client must not reset a company lock by deleting/recreating their subtype row.
drop policy client_profiles_own on public.client_profiles;
create policy client_profiles_read on public.client_profiles for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy client_profiles_update on public.client_profiles for update to authenticated using(user_id=auth.uid() or public.is_admin()) with check(user_id=auth.uid() or public.is_admin());
create policy client_profiles_admin on public.client_profiles for all to authenticated using(public.is_admin()) with check(public.is_admin());
create function public.guard_account_fields() returns trigger language plpgsql set search_path=public as $$
begin
  if current_user='authenticated' and not public.is_admin() then
    if tg_table_name='profiles' then
      new.email:=old.email; new.phone:=old.phone; new.id:=old.id;
    elsif tg_table_name='client_profiles' then
      new.preferred_company_id:=old.preferred_company_id; new.company_locked:=old.company_locked; new.user_id:=old.user_id;
    elsif tg_table_name='cleaner_profiles' then
      new.rating:=old.rating; new.reviews_count:=old.reviews_count;
    elsif tg_table_name='company_profiles' then
      new.rating:=old.rating; new.reviews_count:=old.reviews_count; new.owner_id:=old.owner_id; new.company_code:=old.company_code;
    elsif tg_table_name='notifications' then
      new:=old; new.read_at:=now();
    end if;
  end if;
  return new;
end; $$;
create trigger guard_account_fields before update on public.profiles for each row execute function public.guard_account_fields();
create trigger guard_account_fields before update on public.client_profiles for each row execute function public.guard_account_fields();
create trigger guard_account_fields before update on public.cleaner_profiles for each row execute function public.guard_account_fields();
create trigger guard_account_fields before update on public.company_profiles for each row execute function public.guard_account_fields();
create trigger guard_account_fields before update on public.notifications for each row execute function public.guard_account_fields();

drop policy documents_owner_insert on public.verification_documents;
create policy documents_owner_insert on public.verification_documents for insert to authenticated with check(
  owner_id=auth.uid() and status='pending' and reviewed_by is null and reviewed_at is null and
  (company_id is null or exists(select 1 from company_profiles c where c.id=company_id and c.owner_id=auth.uid())) and
  exists(select 1 from storage.objects s where s.bucket_id='verification-documents' and s.name=storage_path and split_part(s.name,'/',1)=auth.uid()::text)
);
drop policy dispute_messages_insert on public.dispute_messages;
create policy dispute_messages_insert on public.dispute_messages for insert to authenticated with check(
  sender_id=auth.uid() and (not is_admin_note or public.is_admin()) and char_length(message) between 1 and 4000 and cardinality(attachment_urls)<=10 and
  exists(select 1 from public.disputes d where d.id=dispute_id and public.is_order_participant(d.order_id)) and
  not exists(select 1 from unnest(attachment_urls) path where split_part(path,'/',1)<>auth.uid()::text)
);

-- The row lock, assignment/shift checks, real photo ownership, history and notifications
-- are one transaction, so a web action cannot bypass the native business rules.
create function public.advance_company_order(target_order_id uuid, completion_paths text[] default '{}') returns public.orders
language plpgsql security definer set search_path=public as $$
declare o orders; next order_status; uid uuid:=auth.uid();
begin
  select * into o from orders where id=target_order_id for update;
  if not found or not exists(select 1 from order_workers w join cleaner_profiles cp on cp.user_id=w.cleaner_id join profiles p on p.id=cp.user_id
    where w.order_id=o.id and w.cleaner_id=uid and p.status='active' and cp.verification_status='approved' and cp.is_available and cp.workday_ends_at>now())
    then raise exception 'Active assigned cleaner required'; end if;
  next:=case o.status when 'accepted' then 'on_the_way'::order_status when 'on_the_way' then 'arrived'::order_status when 'arrived' then 'in_progress'::order_status when 'in_progress' then 'completed_by_cleaner'::order_status else null end;
  if next is null then raise exception 'Order step unavailable'; end if;
  if next='completed_by_cleaner' then
    if completion_paths is null or cardinality(completion_paths) not between 1 and 10 or exists(select 1 from unnest(completion_paths) path
      where path is null or path not like uid::text||'/completion-'||o.id::text||'-%' or not exists(select 1 from storage.objects s where s.bucket_id='order-photos' and s.name=path))
      then raise exception 'Upload your own completion photos first'; end if;
    update orders set photo_urls=photo_urls||completion_paths where id=o.id;
  end if;
  o:=public.transition_order_status(o.id,next,null);
  insert into notifications(user_id,order_id,type,title,body)
    select c.owner_id,o.id,'order_status','Статус заказа изменён','Новый статус: '||next from company_profiles c where c.id=o.selected_company_id;
  return o;
end; $$;
revoke all on function public.advance_company_order(uuid,text[]) from public,anon;
grant execute on function public.advance_company_order(uuid,text[]) to authenticated;

create function public.update_published_company_order(target_order_id uuid, target_required_workers integer, target_cleaner_amount_minor bigint) returns public.orders
language plpgsql security definer set search_path=public as $$
declare o orders;
begin
  select x.* into o from orders x join company_profiles c on c.id=x.selected_company_id join profiles p on p.id=c.owner_id
    where x.id=target_order_id and c.owner_id=auth.uid() and c.verification_status='approved' and p.status='active' and x.status='accepted' for update of x;
  if not found then raise exception 'Order unavailable'; end if;
  if target_required_workers is null or target_required_workers not between 1 and 50 or target_required_workers<(select count(*) from order_workers where order_id=o.id)
    then raise exception 'Invalid worker count'; end if;
  if target_cleaner_amount_minor is null or target_cleaner_amount_minor<target_required_workers*100 or target_cleaner_amount_minor>o.subtotal_minor then raise exception 'Invalid cleaner payout'; end if;
  update orders set required_workers=target_required_workers,executor_amount_minor=target_cleaner_amount_minor where id=o.id returning * into o;
  return o;
end; $$;
revoke all on function public.update_published_company_order(uuid,integer,bigint) from public,anon;
grant execute on function public.update_published_company_order(uuid,integer,bigint) to authenticated;

-- PostgreSQL grants EXECUTE to PUBLIC by default. Anonymous callers must not
-- execute security-definer helpers; authenticated policies still need them.
revoke execute on all functions in schema public from public,anon;
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in (
    'is_admin','current_profile_role','current_cleaner_verification','current_company_verification','is_order_participant','can_read_profile','make_referral_code','make_company_code','is_my_linked_company'
  ) loop execute format('grant execute on function %s to authenticated', f.signature); end loop;
end; $$;
grant execute on all functions in schema public to service_role;
revoke all on function public.finalize_order_finances(uuid) from authenticated;

create function public.guard_order_progress() returns trigger
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid();
begin
  if uid is null or public.is_admin() or new.status=old.status then return new; end if;
  if exists(select 1 from cleaner_profiles where user_id=uid) and new.status in ('on_the_way','arrived','in_progress','completed_by_cleaner') and
    not exists(select 1 from cleaner_profiles cp join profiles p on p.id=cp.user_id where cp.user_id=uid and cp.verification_status='approved' and cp.is_available and cp.workday_ends_at>now() and p.status='active')
    then raise exception 'Active approved cleaner shift required'; end if;
  if new.selected_company_id is not null and new.status='completed_by_cleaner' and not exists(
    select 1 from unnest(new.photo_urls) path join storage.objects s on s.name=path and s.bucket_id='order-photos'
    where path like uid::text||'/completion-'||new.id::text||'-%'
  ) then raise exception 'Upload your own completion photos first'; end if;
  return new;
end; $$;
create trigger guard_order_progress before update of status on public.orders for each row execute function public.guard_order_progress();
revoke all on function public.guard_order_progress() from public,anon,authenticated;
