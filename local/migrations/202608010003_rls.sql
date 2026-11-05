do $$ declare t text; begin foreach t in array array[
 'profiles','client_profiles','cleaner_profiles','company_profiles','company_cleaners','cleaning_services','service_options','addresses','orders','order_items','order_status_history','order_assignments','cleaner_availability','cleaner_locations','reviews','review_photos','referral_codes','referrals','referral_rewards','wallets','wallet_transactions','platform_settings','notifications','disputes','dispute_messages','subscriptions','verification_documents','admin_action_logs'
] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

create policy profiles_read on public.profiles for select to authenticated using(status='active' or id=auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid() and role=public.current_profile_role());
create policy admin_profiles_all on public.profiles for all to authenticated using(public.is_admin()) with check(public.is_admin());

create policy client_profiles_own on public.client_profiles for all to authenticated using(user_id=auth.uid() or public.is_admin()) with check(user_id=auth.uid() or public.is_admin());
create policy cleaner_profiles_read on public.cleaner_profiles for select to authenticated using(verification_status='approved' or user_id=auth.uid() or public.is_admin());
create policy cleaner_profiles_own_update on public.cleaner_profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and verification_status=public.current_cleaner_verification());
create policy admin_cleaner_profiles on public.cleaner_profiles for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy companies_read on public.company_profiles for select to authenticated using(verification_status='approved' or owner_id=auth.uid() or public.is_admin());
create policy companies_owner_update on public.company_profiles for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid() and verification_status=public.current_company_verification());
create policy admin_companies on public.company_profiles for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy company_cleaners_member_read on public.company_cleaners for select to authenticated using(cleaner_id=auth.uid() or exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid()) or public.is_admin());
create policy company_cleaners_owner_write on public.company_cleaners for all to authenticated using(exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid()) or public.is_admin()) with check(exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid()) or public.is_admin());

create policy services_public_read on public.cleaning_services for select to authenticated using(is_active or public.is_admin());
create policy services_admin_write on public.cleaning_services for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy options_public_read on public.service_options for select to authenticated using(is_active or public.is_admin());
create policy options_admin_write on public.service_options for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy addresses_own on public.addresses for all to authenticated using(user_id=auth.uid() or public.is_admin()) with check(user_id=auth.uid() or public.is_admin());

create policy orders_participants_read on public.orders for select to authenticated using(
 client_id=auth.uid() or public.is_admin() or
 (status in ('searching','offered') and exists(select 1 from public.cleaner_profiles where user_id=auth.uid() and verification_status='approved')) or
 exists(select 1 from public.order_assignments a where a.order_id=id and a.is_active and (a.cleaner_id=auth.uid() or exists(select 1 from public.company_profiles c where c.id=a.company_id and c.owner_id=auth.uid())))
);
create policy orders_admin_write on public.orders for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy order_items_participant_read on public.order_items for select to authenticated using(public.is_order_participant(order_id));
create policy status_history_participant_read on public.order_status_history for select to authenticated using(public.is_order_participant(order_id));
create policy assignments_participant_read on public.order_assignments for select to authenticated using(public.is_order_participant(order_id));
create policy assignments_company_update on public.order_assignments for update to authenticated using(exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid()) or public.is_admin()) with check(exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid()) or public.is_admin());
create policy availability_public_read on public.cleaner_availability for select to authenticated using(true);
create policy availability_own_write on public.cleaner_availability for all to authenticated using(cleaner_id=auth.uid() or public.is_admin()) with check(cleaner_id=auth.uid() or public.is_admin());
create policy locations_active_participant_read on public.cleaner_locations for select to authenticated using(public.is_order_participant(order_id) and exists(select 1 from public.orders o where o.id=order_id and o.status in ('on_the_way','arrived','in_progress')));

create policy reviews_visible_read on public.reviews for select to authenticated using(is_visible or client_id=auth.uid() or public.is_admin());
create policy reviews_admin_update on public.reviews for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy review_photos_read on public.review_photos for select to authenticated using(exists(select 1 from public.reviews r where r.id=review_id and (r.is_visible or r.client_id=auth.uid() or public.is_admin())));
create policy referral_codes_read_own on public.referral_codes for select to authenticated using(owner_id=auth.uid() or public.is_admin());
create policy referrals_read_parties on public.referrals for select to authenticated using(referrer_id=auth.uid() or referred_user_id=auth.uid() or public.is_admin());
create policy rewards_read_owner on public.referral_rewards for select to authenticated using(beneficiary_id=auth.uid() or referred_user_id=auth.uid() or public.is_admin());
create policy wallets_read_owner on public.wallets for select to authenticated using(owner_id=auth.uid() or public.is_admin());
create policy wallet_transactions_read_owner on public.wallet_transactions for select to authenticated using(owner_id=auth.uid() or public.is_admin());
create policy settings_read on public.platform_settings for select to authenticated using(true);
create policy settings_admin_write on public.platform_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());

create policy notifications_own_read on public.notifications for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy notifications_own_update on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy disputes_participant_read on public.disputes for select to authenticated using(public.is_order_participant(order_id));
create policy disputes_admin_update on public.disputes for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy dispute_messages_read on public.dispute_messages for select to authenticated using(exists(select 1 from public.disputes d where d.id=dispute_id and public.is_order_participant(d.order_id) and (not is_admin_note or public.is_admin())));
create policy dispute_messages_insert on public.dispute_messages for insert to authenticated with check(sender_id=auth.uid() and exists(select 1 from public.disputes d where d.id=dispute_id and public.is_order_participant(d.order_id)));
create policy subscriptions_company_read on public.subscriptions for select to authenticated using(exists(select 1 from public.company_profiles c where c.id=company_id and c.owner_id=auth.uid()) or public.is_admin());
create policy subscriptions_admin_write on public.subscriptions for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy documents_owner_read on public.verification_documents for select to authenticated using(owner_id=auth.uid() or public.is_admin());
create policy documents_owner_insert on public.verification_documents for insert to authenticated with check(owner_id=auth.uid());
create policy documents_admin_update on public.verification_documents for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy admin_logs_admin_only on public.admin_action_logs for select to authenticated using(public.is_admin());
create policy admin_logs_admin_insert on public.admin_action_logs for insert to authenticated with check(public.is_admin() and admin_id=auth.uid());

grant usage on schema public to authenticated;
grant select on public.cleaning_services,public.service_options to authenticated;
grant select,update on public.profiles,public.client_profiles,public.cleaner_profiles,public.company_profiles to authenticated;
grant select,insert,update,delete on public.addresses,public.cleaner_availability,public.company_cleaners to authenticated;
grant select on public.orders,public.order_items,public.order_status_history,public.order_assignments,public.cleaner_locations,public.reviews,public.review_photos,public.referral_codes,public.referrals,public.referral_rewards,public.wallets,public.wallet_transactions,public.platform_settings,public.notifications,public.disputes,public.dispute_messages,public.subscriptions,public.verification_documents,public.admin_action_logs to authenticated;
grant insert on public.dispute_messages,public.verification_documents to authenticated;
grant update on public.notifications to authenticated;
grant insert on public.admin_action_logs to authenticated;

-- Storage buckets must be private; access is scoped to the first path segment (user id).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp']),
 ('order-photos','order-photos',false,10485760,array['image/jpeg','image/png','image/webp']),
 ('verification-documents','verification-documents',false,15728640,array['image/jpeg','image/png','application/pdf'])
on conflict(id) do nothing;
create policy storage_owner_read on storage.objects for select to authenticated using((storage.foldername(name))[1]=auth.uid()::text or public.is_admin());
create policy storage_owner_insert on storage.objects for insert to authenticated with check((storage.foldername(name))[1]=auth.uid()::text);
create policy storage_owner_update on storage.objects for update to authenticated using((storage.foldername(name))[1]=auth.uid()::text) with check((storage.foldername(name))[1]=auth.uid()::text);
create policy storage_owner_delete on storage.objects for delete to authenticated using((storage.foldername(name))[1]=auth.uid()::text);
