-- A shift has an explicit deadline. GPS writes and reads stop at that time even
-- if the cleaner leaves the app open or the device goes offline.
alter table public.cleaner_profiles add column if not exists workday_ends_at timestamptz;
update public.cleaner_profiles set workday_ends_at = now() + interval '8 hours'
where is_available and workday_ends_at is null;
create index if not exists cleaner_profiles_workday_deadline_idx
  on public.cleaner_profiles(workday_ends_at) where is_available;

create or replace function public.set_cleaner_workday(target_active boolean, duration_hours integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid();
begin
  if target_active is null or not exists(
    select 1 from profiles where id=uid and role in ('cleaner','company_cleaner') and status='active'
  ) then raise exception 'Active cleaner account required'; end if;
  if target_active and (duration_hours is null or duration_hours not between 1 and 12) then
    raise exception 'Shift duration must be between 1 and 12 hours';
  end if;
  update cleaner_profiles set is_available=target_active,
    workday_ends_at=case when target_active then now()+make_interval(hours=>duration_hours) else null end
  where user_id=uid and verification_status='approved';
  if not found then raise exception 'Approved cleaner profile required'; end if;
  if not target_active then delete from cleaner_locations where cleaner_id=uid; end if;
  return target_active;
end; $$;
revoke all on function public.set_cleaner_workday(boolean,integer) from public,anon;
grant execute on function public.set_cleaner_workday(boolean,integer) to authenticated;

-- Older clients still call the single-argument RPC.
create or replace function public.set_cleaner_workday(target_active boolean)
returns boolean language sql security definer set search_path=public as $$
  select public.set_cleaner_workday(target_active, 8);
$$;
revoke all on function public.set_cleaner_workday(boolean) from public,anon;
grant execute on function public.set_cleaner_workday(boolean) to authenticated;

create or replace function public.update_cleaner_location(
  target_order_id uuid, lat numeric, lng numeric,
  target_heading numeric default null, target_speed numeric default null
) returns public.cleaner_locations
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result cleaner_locations;
begin
  if lat is null or lng is null or lat not between -90 and 90 or lng not between -180 and 180 then
    raise exception 'Invalid coordinates';
  end if;
  perform 1 from cleaner_profiles cp join profiles p on p.id=cp.user_id
  where cp.user_id=uid and cp.verification_status='approved' and cp.is_available
    and cp.workday_ends_at > now() and p.status='active'
    and p.role in ('cleaner','company_cleaner')
  for update of cp;
  if not found then raise exception 'Workday has ended'; end if;
  perform 1 from orders o where o.id=target_order_id
    and o.status in ('accepted','on_the_way','arrived','in_progress')
    and (exists(select 1 from order_workers w where w.order_id=o.id and w.cleaner_id=uid)
      or exists(select 1 from order_assignments a where a.order_id=o.id and a.is_active and a.cleaner_id=uid))
  for update of o;
  if not found then raise exception 'Location sharing is inactive'; end if;
  insert into cleaner_locations(order_id,cleaner_id,latitude,longitude,heading,speed,recorded_at)
  values(target_order_id,uid,lat,lng,target_heading,target_speed,now())
  on conflict(order_id,cleaner_id) do update set
    latitude=excluded.latitude,longitude=excluded.longitude,
    heading=excluded.heading,speed=excluded.speed,recorded_at=now()
  returning * into result;
  return result;
end; $$;
revoke all on function public.update_cleaner_location(uuid,numeric,numeric,numeric,numeric) from public;
grant execute on function public.update_cleaner_location(uuid,numeric,numeric,numeric,numeric) to authenticated;

drop policy if exists locations_active_participant_read on public.cleaner_locations;
create policy locations_active_participant_read on public.cleaner_locations for select to authenticated using (
  exists(select 1 from profiles p where p.id=auth.uid() and p.status='active')
  and public.is_order_participant(order_id)
  and exists(select 1 from orders o where o.id=cleaner_locations.order_id and o.status in ('accepted','on_the_way','arrived','in_progress'))
  and exists(select 1 from cleaner_profiles cp where cp.user_id=cleaner_locations.cleaner_id
    and cp.is_available and cp.workday_ends_at > now())
);

-- Claiming a new job must respect the same shift deadline as GPS sharing.
create or replace function public.can_claim_community_company(target_company uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from community_companies cc
    join cleaner_communities community on community.id=cc.community_id and community.is_active
    join community_cleaners cm on cm.community_id=cc.community_id and cm.cleaner_id=auth.uid()
    join cleaner_profiles cp on cp.user_id=cm.cleaner_id
    join profiles p on p.id=cp.user_id
    where cc.company_id=target_company and cp.verification_status='approved'
      and cp.is_available and cp.workday_ends_at>now()
      and p.status='active' and p.role in ('cleaner','company_cleaner')
  );
$$;
