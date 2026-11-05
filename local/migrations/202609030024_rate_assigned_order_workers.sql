create or replace function public.create_review(
  target_order_id uuid,
  target_rating smallint,
  target_text text default null,
  target_tags text[] default '{}'
) returns public.reviews
language plpgsql security definer set search_path=public as $$
declare
  uid uuid := auth.uid();
  o orders;
  a order_assignments;
  result reviews;
  worker_id uuid;
begin
  select * into o
  from orders
  where id = target_order_id and client_id = uid and status = 'completed';

  if not found then
    raise exception 'Completed order not found';
  end if;

  if target_rating not between 1 and 5 then
    raise exception 'Rating must be 1..5';
  end if;

  select * into result from reviews where order_id = o.id;
  if found then
    return result;
  end if;

  select * into a
  from order_assignments
  where order_id = o.id and is_active
  order by created_at desc
  limit 1;

  insert into reviews(order_id, client_id, cleaner_id, company_id, rating, text, tags)
  values(o.id, uid, a.cleaner_id, a.company_id, target_rating, target_text, target_tags)
  on conflict(order_id) do nothing
  returning * into result;

  if result.id is null then
    select * into result from reviews where order_id = o.id;
    return result;
  end if;

  for worker_id in
    select ow.cleaner_id from order_workers ow where ow.order_id = o.id
    union
    select a.cleaner_id where a.cleaner_id is not null
  loop
    update cleaner_profiles cp
    set rating = x.avg, reviews_count = x.cnt
    from (
      select round(avg(r.rating), 2) avg, count(*) cnt
      from reviews r
      where r.is_visible and (
        r.cleaner_id = worker_id
        or exists (
          select 1 from order_workers ow
          where ow.order_id = r.order_id and ow.cleaner_id = worker_id
        )
      )
    ) x
    where cp.user_id = worker_id;
  end loop;

  if a.company_id is not null then
    update company_profiles cp
    set rating = x.avg, reviews_count = x.cnt
    from (
      select round(avg(rating), 2) avg, count(*) cnt
      from reviews
      where company_id = a.company_id and is_visible
    ) x
    where cp.id = a.company_id;
  end if;

  return result;
end;
$$;

-- Apply existing visible order reviews to every cleaner who worked on them.
update cleaner_profiles cp
set
  rating = (
    select round(avg(r.rating), 2)
    from reviews r
    where r.is_visible and (
      r.cleaner_id = cp.user_id
      or exists (
        select 1 from order_workers ow
        where ow.order_id = r.order_id and ow.cleaner_id = cp.user_id
      )
    )
  ),
  reviews_count = (
    select count(*)
    from reviews r
    where r.is_visible and (
      r.cleaner_id = cp.user_id
      or exists (
        select 1 from order_workers ow
        where ow.order_id = r.order_id and ow.cleaner_id = cp.user_id
      )
    )
  )
where exists (
  select 1
  from reviews r
  where r.is_visible and (
    r.cleaner_id = cp.user_id
    or exists (
      select 1 from order_workers ow
      where ow.order_id = r.order_id and ow.cleaner_id = cp.user_id
    )
  )
);

grant execute on function public.create_review(uuid, smallint, text, text[]) to authenticated;
