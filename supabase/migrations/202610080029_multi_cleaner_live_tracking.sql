-- One current GPS point per assigned cleaner, scoped to an active order.
-- Preserve existing points while removing the old one-cleaner-per-order limit.
alter table public.cleaner_locations drop constraint if exists cleaner_locations_order_id_key;
create unique index if not exists cleaner_locations_order_cleaner_key on public.cleaner_locations(order_id, cleaner_id);

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
  -- Row lock serializes location writes against completion/cancellation.
  perform 1 from orders o join profiles p on p.id=uid
  where o.id=target_order_id and p.status='active' and p.role in ('cleaner','company_cleaner')
    and o.status in ('accepted','on_the_way','arrived','in_progress')
    and (exists(select 1 from order_workers w where w.order_id=o.id and w.cleaner_id=uid)
      or exists(select 1 from order_assignments a where a.order_id=o.id and a.is_active and a.cleaner_id=uid))
  for update of o;
  if not found then raise exception 'Location sharing is inactive'; end if;
  insert into cleaner_locations(order_id,cleaner_id,latitude,longitude,heading,speed,recorded_at)
  values(target_order_id,uid,lat,lng,target_heading,target_speed,now())
  on conflict(order_id,cleaner_id) do update set
    latitude=excluded.latitude,longitude=excluded.longitude,heading=excluded.heading,speed=excluded.speed,recorded_at=now()
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
);

-- Server actions also update orders directly: stop tracking on every terminal path.
create or replace function public.clear_inactive_order_locations() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status not in ('accepted','on_the_way','arrived','in_progress') then
    delete from cleaner_locations where order_id=new.id;
  end if;
  return new;
end; $$;
drop trigger if exists clear_inactive_order_locations on public.orders;
create trigger clear_inactive_order_locations after update of status on public.orders
for each row execute function public.clear_inactive_order_locations();
delete from public.cleaner_locations l where not exists(
  select 1 from public.orders o where o.id=l.order_id and o.status in ('accepted','on_the_way','arrived','in_progress')
);
-- cleaner_locations and orders are already in supabase_realtime in the base schema.
