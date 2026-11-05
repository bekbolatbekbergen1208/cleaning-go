-- Anonymous visitors can read the active catalog, while account data stays private.
create policy local_services_anonymous on public.cleaning_services for select to anon using(is_active);
create policy local_options_anonymous on public.service_options for select to anon using(is_active);
