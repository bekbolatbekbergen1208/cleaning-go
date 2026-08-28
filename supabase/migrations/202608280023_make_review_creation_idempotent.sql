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

  -- Retrying a successful request must return the saved review, not a unique-key error.
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

  -- Handles two requests arriving concurrently: the other request created the row.
  if result.id is null then
    select * into result from reviews where order_id = o.id;
    return result;
  end if;

  if a.cleaner_id is not null then
    update cleaner_profiles cp
    set rating = x.avg, reviews_count = x.cnt
    from (
      select round(avg(rating), 2) avg, count(*) cnt
      from reviews
      where cleaner_id = a.cleaner_id and is_visible
    ) x
    where cp.user_id = a.cleaner_id;
  end if;

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
