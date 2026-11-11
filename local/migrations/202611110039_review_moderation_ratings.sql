-- Moderation must update public ratings just like creating a review does.
create function public.refresh_moderated_review_ratings() returns trigger
language plpgsql security definer set search_path=public as $$
declare worker_id uuid; target_company uuid;
begin
  for worker_id in
    select w.cleaner_id from order_workers w where w.order_id in (old.order_id,new.order_id)
    union select unnest(array[old.cleaner_id,new.cleaner_id])
  loop
    if worker_id is null then continue; end if;
    update cleaner_profiles cp set rating=aggregate.avg,reviews_count=aggregate.cnt
    from (
      select coalesce(round(avg(r.rating),2),0) avg,count(*)::integer cnt
      from reviews r where r.is_visible and (r.cleaner_id=worker_id or
        exists(select 1 from order_workers w where w.order_id=r.order_id and w.cleaner_id=worker_id))
    ) aggregate where cp.user_id=worker_id;
  end loop;
  for target_company in select distinct unnest(array[old.company_id,new.company_id])
  loop
    if target_company is null then continue; end if;
    update company_profiles cp set rating=aggregate.avg,reviews_count=aggregate.cnt
    from (select coalesce(round(avg(r.rating),2),0) avg,count(*)::integer cnt from reviews r
      where r.is_visible and r.company_id=target_company) aggregate
    where cp.id=target_company;
  end loop;
  return new;
end; $$;
revoke all on function public.refresh_moderated_review_ratings() from public,anon,authenticated;
create trigger refresh_moderated_review_ratings after update of is_visible,rating,cleaner_id,company_id,order_id on public.reviews
for each row execute function public.refresh_moderated_review_ratings();

-- Repair ratings left stale by previously hidden/restored reviews.
update cleaner_profiles cp set
  rating=(select coalesce(round(avg(r.rating),2),0) from reviews r where r.is_visible and
    (r.cleaner_id=cp.user_id or exists(select 1 from order_workers w where w.order_id=r.order_id and w.cleaner_id=cp.user_id))),
  reviews_count=(select count(*) from reviews r where r.is_visible and
    (r.cleaner_id=cp.user_id or exists(select 1 from order_workers w where w.order_id=r.order_id and w.cleaner_id=cp.user_id)));
update company_profiles cp set
  rating=(select coalesce(round(avg(r.rating),2),0) from reviews r where r.company_id=cp.id and r.is_visible),
  reviews_count=(select count(*) from reviews r where r.company_id=cp.id and r.is_visible);
