-- A cleaner controls the workday. Ending it immediately removes all live GPS
-- points and prevents every client (including the mobile app) from posting more.
create or replace function public.set_cleaner_workday(target_active boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid();
begin
  if target_active is null or not exists(
    select 1 from profiles where id=uid and role in ('cleaner','company_cleaner') and status='active'
  ) then raise exception 'Active cleaner account required'; end if;
  update cleaner_profiles set is_available=target_active
  where user_id=uid and verification_status='approved';
  if not found then raise exception 'Approved cleaner profile required'; end if;
  if not target_active then delete from cleaner_locations where cleaner_id=uid; end if;
  return target_active;
end; $$;
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
  -- The same row lock is held by set_cleaner_workday, so a final GPS write
  -- cannot race with the cleanup at the end of the day.
  perform 1 from cleaner_profiles cp join profiles p on p.id=cp.user_id
  where cp.user_id=uid and cp.verification_status='approved' and cp.is_available
    and p.status='active' and p.role in ('cleaner','company_cleaner')
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
