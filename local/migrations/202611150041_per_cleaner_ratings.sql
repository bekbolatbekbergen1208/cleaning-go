-- Separate ratings: the client rates the company (reviews.rating, as before)
-- and every cleaner who worked on the order individually.
create table public.cleaner_ratings (
  order_id uuid not null references public.orders(id) on delete cascade,
  cleaner_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id),
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (order_id, cleaner_id)
);
create index cleaner_ratings_cleaner_idx on public.cleaner_ratings(cleaner_id);
alter table public.cleaner_ratings enable row level security;
-- Read-only through the API; rows are written only by create_order_review().
create policy cleaner_ratings_read on public.cleaner_ratings for select to authenticated
  using (client_id = auth.uid() or cleaner_id = auth.uid() or public.is_admin());

-- Everyone who worked on an order: company team members or the direct cleaner.
create function public.order_cleaner_ids(target_order_id uuid) returns setof uuid
language sql stable security definer set search_path=public as $$
  select ow.cleaner_id from order_workers ow where ow.order_id = target_order_id
  union
  select o.selected_cleaner_id from orders o where o.id = target_order_id and o.selected_company_id is null and o.selected_cleaner_id is not null
  union
  select a.cleaner_id from order_assignments a where a.order_id = target_order_id and a.is_active and a.cleaner_id is not null
$$;

-- A cleaner's score for an order is their own rating; orders rated before this
-- change fall back to the order's overall rating. Hidden reviews never count.
create function public.refresh_cleaner_rating(target_cleaner uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  update cleaner_profiles cp set rating = x.avg, reviews_count = x.cnt
  from (
    select coalesce(round(avg(coalesce(cr.rating, r.rating)), 2), 0) avg, count(*)::integer cnt
    from reviews r
    left join cleaner_ratings cr on cr.order_id = r.order_id and cr.cleaner_id = target_cleaner
    where r.is_visible and (
      r.cleaner_id = target_cleaner
      or exists (select 1 from order_workers ow where ow.order_id = r.order_id and ow.cleaner_id = target_cleaner)
      or cr.cleaner_id is not null
    )
  ) x
  where cp.user_id = target_cleaner;
end; $$;

create function public.create_order_review(
  target_order_id uuid,
  target_company_rating smallint default null,
  target_cleaner_ratings jsonb default '{}'::jsonb,
  target_text text default null
) returns public.reviews
language plpgsql security definer set search_path=public as $$
declare
  uid uuid := auth.uid();
  o orders;
  result reviews;
  team uuid[];
  item record;
  overall smallint;
  worker uuid;
begin
  select * into o from orders where id = target_order_id and client_id = uid and status = 'completed';
  if not found then raise exception 'Completed order not found'; end if;
  if jsonb_typeof(coalesce(target_cleaner_ratings, '{}'::jsonb)) <> 'object' then raise exception 'Invalid cleaner ratings'; end if;
  if char_length(coalesce(target_text, '')) > 2000 then raise exception 'Review text is too long'; end if;
  select coalesce(array_agg(id), '{}') into team from public.order_cleaner_ids(o.id) id;

  for item in select key, value from jsonb_each(coalesce(target_cleaner_ratings, '{}'::jsonb)) loop
    if item.key !~ '^[0-9a-fA-F-]{36}$' or not (item.key::uuid = any(team)) then raise exception 'This cleaner did not work on the order'; end if;
    if jsonb_typeof(item.value) <> 'number' or (item.value::text)::numeric not in (1,2,3,4,5) then raise exception 'Rating must be 1..5'; end if;
  end loop;

  -- The order review keeps one overall rating: the company's for company
  -- orders, the cleaner's own for a direct order.
  if o.selected_company_id is not null then
    if target_company_rating is null or target_company_rating not between 1 and 5 then raise exception 'Rate the company 1..5'; end if;
    overall := target_company_rating;
  else
    overall := coalesce(target_company_rating, (select (value::text)::smallint from jsonb_each(target_cleaner_ratings) limit 1));
    if overall is null or overall not between 1 and 5 then raise exception 'Rate the cleaner 1..5'; end if;
  end if;

  result := public.create_review(o.id, overall, nullif(btrim(target_text), ''), '{}');

  insert into cleaner_ratings(order_id, cleaner_id, client_id, rating)
  select o.id, key::uuid, uid, (value::text)::smallint from jsonb_each(coalesce(target_cleaner_ratings, '{}'::jsonb))
  on conflict (order_id, cleaner_id) do nothing;

  foreach worker in array team loop perform public.refresh_cleaner_rating(worker); end loop;
  return result;
end; $$;

-- Moderation (hide/restore a review) recomputes with the same per-cleaner formula.
create or replace function public.refresh_moderated_review_ratings() returns trigger
language plpgsql security definer set search_path=public as $$
declare worker_id uuid; target_company uuid;
begin
  for worker_id in
    select w.cleaner_id from order_workers w where w.order_id in (old.order_id, new.order_id)
    union select cr.cleaner_id from cleaner_ratings cr where cr.order_id in (old.order_id, new.order_id)
    union select unnest(array[old.cleaner_id, new.cleaner_id])
  loop
    if worker_id is not null then perform public.refresh_cleaner_rating(worker_id); end if;
  end loop;
  for target_company in select distinct unnest(array[old.company_id, new.company_id]) loop
    if target_company is null then continue; end if;
    update company_profiles cp set rating = aggregate.avg, reviews_count = aggregate.cnt
    from (select coalesce(round(avg(r.rating), 2), 0) avg, count(*)::integer cnt from reviews r
      where r.is_visible and r.company_id = target_company) aggregate
    where cp.id = target_company;
  end loop;
  return new;
end; $$;

revoke all on function public.order_cleaner_ids(uuid) from public, anon, authenticated;
revoke all on function public.refresh_cleaner_rating(uuid) from public, anon, authenticated;
revoke all on function public.create_order_review(uuid, smallint, jsonb, text) from public, anon;
grant execute on function public.create_order_review(uuid, smallint, jsonb, text) to authenticated;
