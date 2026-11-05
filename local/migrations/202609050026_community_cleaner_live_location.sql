-- Allow cleaners who claimed a community order to publish their live location.
create or replace function public.update_cleaner_location(
  target_order_id uuid,
  lat numeric,
  lng numeric,
  target_heading numeric default null,
  target_speed numeric default null
) returns public.cleaner_locations
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); result cleaner_locations;
begin
  if lat not between -90 and 90 or lng not between -180 and 180 then
    raise exception 'Invalid coordinates';
  end if;
  if not exists(
    select 1 from orders o
    where o.id=target_order_id
      and o.status in ('on_the_way','arrived','in_progress')
      and (
        exists(select 1 from order_workers w where w.order_id=o.id and w.cleaner_id=uid)
        or exists(select 1 from order_assignments a where a.order_id=o.id and a.is_active and a.cleaner_id=uid)
      )
  ) then raise exception 'Location sharing is inactive'; end if;

  insert into cleaner_locations(order_id,cleaner_id,latitude,longitude,heading,speed,recorded_at)
  values(target_order_id,uid,lat,lng,target_heading,target_speed,now())
  on conflict(order_id) do update set
    cleaner_id=excluded.cleaner_id,
    latitude=excluded.latitude,
    longitude=excluded.longitude,
    heading=excluded.heading,
    speed=excluded.speed,
    recorded_at=now()
  returning * into result;
  return result;
end; $$;

grant execute on function public.update_cleaner_location(uuid,numeric,numeric,numeric,numeric) to authenticated;
