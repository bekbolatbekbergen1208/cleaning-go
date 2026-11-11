-- Bind consent to the quote actually shown to the client, not whatever quote
-- happens to be current when a delayed form submission reaches the server.
alter table public.orders add column quote_version bigint not null default 0;
update public.orders set quote_version=1 where status='offered' or price_confirmed_at is not null;

alter function public.propose_company_order_price(uuid,bigint,integer,bigint) rename to propose_company_order_price_unchecked;
revoke all on function public.propose_company_order_price_unchecked(uuid,bigint,integer,bigint) from public,anon,authenticated;
create function public.propose_company_order_price(target_order_id uuid,target_total_minor bigint,target_required_workers integer,target_cleaner_amount_minor bigint)
returns public.orders language plpgsql security definer set search_path=public as $$
declare o orders;
begin
  o:=public.propose_company_order_price_unchecked(target_order_id,target_total_minor,target_required_workers,target_cleaner_amount_minor);
  update orders set quote_version=quote_version+1 where id=o.id returning * into o;
  return o;
end; $$;
revoke all on function public.propose_company_order_price(uuid,bigint,integer,bigint) from public,anon;
grant execute on function public.propose_company_order_price(uuid,bigint,integer,bigint) to authenticated,service_role;

alter function public.confirm_company_order_price(uuid) rename to confirm_company_order_price_unchecked;
revoke all on function public.confirm_company_order_price_unchecked(uuid) from public,anon,authenticated;
create function public.confirm_company_order_price(target_order_id uuid,expected_quote_version bigint default null)
returns public.orders language plpgsql security definer set search_path=public as $$
declare o orders;
begin
  select * into o from orders where id=target_order_id and client_id=auth.uid() for update;
  if not found then raise exception 'Order unavailable'; end if;
  if expected_quote_version is null or expected_quote_version<>o.quote_version then
    raise exception 'Цена заказа изменилась. Обновите страницу и подтвердите новую цену.';
  end if;
  return public.confirm_company_order_price_unchecked(target_order_id);
end; $$;
revoke all on function public.confirm_company_order_price(uuid,bigint) from public,anon;
grant execute on function public.confirm_company_order_price(uuid,bigint) to authenticated,service_role;

-- Repeated or concurrent submissions of the same visible step are idempotent.
-- Older forms without a step must refresh instead of guessing the current step.
drop function public.advance_company_order(uuid,text[]);
create function public.advance_company_order(target_order_id uuid,completion_paths text[] default '{}',expected_status public.order_status default null)
returns public.orders language plpgsql security definer set search_path=public as $$
declare o orders; next order_status; uid uuid:=auth.uid();
begin
  select * into o from orders where id=target_order_id for update;
  if not found or not exists(select 1 from order_workers w join cleaner_profiles cp on cp.user_id=w.cleaner_id join profiles p on p.id=cp.user_id
    where w.order_id=o.id and w.cleaner_id=uid and p.status='active' and cp.verification_status='approved' and cp.is_available and cp.workday_ends_at>now())
    then raise exception 'Active assigned cleaner required'; end if;
  next:=case expected_status when 'accepted' then 'on_the_way'::order_status when 'on_the_way' then 'arrived'::order_status when 'arrived' then 'in_progress'::order_status when 'in_progress' then 'completed_by_cleaner'::order_status else null end;
  if next is null then raise exception 'Обновите страницу заказа перед сменой этапа.'; end if;
  if o.status=next then return o; end if;
  if o.status<>expected_status then raise exception 'Этап заказа уже изменился. Обновите страницу.'; end if;
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
revoke all on function public.advance_company_order(uuid,text[],public.order_status) from public,anon;
grant execute on function public.advance_company_order(uuid,text[],public.order_status) to authenticated,service_role;

-- Validate new/edited input without preventing moderation of historical long
-- reviews. A table CHECK would also reject an unrelated visibility update.
create function public.validate_review_input() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.text is not null and char_length(new.text)>2000 then raise exception 'Комментарий должен содержать не более 2000 символов.'; end if;
  if cardinality(new.tags)>10 or exists(select 1 from unnest(new.tags) tag where tag is null or char_length(trim(tag)) not between 1 and 50)
    then raise exception 'Укажите не более 10 тегов длиной до 50 символов.'; end if;
  return new;
end; $$;
revoke all on function public.validate_review_input() from public,anon,authenticated;
create trigger validate_review_input before insert or update of text,tags on public.reviews
for each row execute function public.validate_review_input();
