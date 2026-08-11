create extension if not exists pgcrypto;

create type public.user_role as enum ('client','cleaner','company_owner','company_cleaner','admin');
create type public.profile_status as enum ('active','blocked','deleted');
create type public.verification_status as enum ('pending','approved','rejected','blocked');
create type public.subscription_status as enum ('free','trial','active','expired','blocked');
create type public.order_status as enum ('created','searching','offered','accepted','on_the_way','arrived','in_progress','completed_by_cleaner','completed','cancelled','disputed');
create type public.executor_preference as enum ('cleaner','company','any');
create type public.payment_method as enum ('cash','card','test');
create type public.payment_status as enum ('pending','paid','failed','refunded');
create type public.reward_status as enum ('pending','available','paid','cancelled');
create type public.dispute_status as enum ('open','under_review','resolved_client','resolved_cleaner','resolved_company','closed');
create type public.document_status as enum ('pending','approved','rejected');
create type public.wallet_transaction_type as enum ('referral_reward','order_income','platform_fee','withdrawal','refund','adjustment');

create function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create function public.make_referral_code() returns text language sql volatile set search_path = '' as $$
  select 'CLG-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'client',
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text,
  email text,
  avatar_url text,
  city text,
  status public.profile_status not null default 'active',
  referral_code text not null unique default public.make_referral_code(),
  referred_by uuid references public.profiles(id),
  terms_accepted_at timestamptz not null default now(),
  privacy_accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (referred_by is null or referred_by <> id)
);
create unique index profiles_phone_key on public.profiles(phone) where phone is not null;
create unique index profiles_email_key on public.profiles(lower(email)) where email is not null;
create index profiles_role_city_idx on public.profiles(role, city);

create table public.client_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  preferred_language text not null default 'ru' check (preferred_language in ('ru','kk','en')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.cleaner_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  verification_status public.verification_status not null default 'pending',
  experience_years smallint not null default 0 check (experience_years between 0 and 80),
  bio text, work_zone text, is_available boolean not null default false,
  rating numeric(3,2) not null default 0 check (rating between 0 and 5),
  reviews_count integer not null default 0 check (reviews_count >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index cleaner_profiles_discovery_idx on public.cleaner_profiles(verification_status, is_available);
create table public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete restrict,
  name text not null, logo_url text, description text, registration_number text unique,
  address text, service_cities text[] not null default '{}', contact_phone text, contact_email text,
  verification_status public.verification_status not null default 'pending',
  tariff_status public.subscription_status not null default 'free',
  rating numeric(3,2) not null default 0 check (rating between 0 and 5),
  reviews_count integer not null default 0 check (reviews_count >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index company_profiles_verification_idx on public.company_profiles(verification_status);
create table public.company_cleaners (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.company_profiles(id) on delete cascade,
  cleaner_id uuid not null references public.profiles(id) on delete restrict, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id, cleaner_id)
);
create index company_cleaners_cleaner_idx on public.company_cleaners(cleaner_id) where is_active;

create table public.cleaning_services (
  id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null,
  description text, base_price_minor bigint not null check (base_price_minor >= 0),
  unit text not null, duration_minutes integer not null check (duration_minutes > 0),
  image_url text, is_active boolean not null default true, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.service_options (
  id uuid primary key default gen_random_uuid(), service_id uuid not null references public.cleaning_services(id) on delete cascade,
  name text not null, price_minor bigint not null check (price_minor >= 0), is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(service_id, name)
);
create index service_options_service_idx on public.service_options(service_id) where is_active;
create table public.addresses (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Дом', city text not null, address_line text not null, apartment text,
  entrance text, floor text, latitude numeric(9,6), longitude numeric(9,6), is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (latitude is null or latitude between -90 and 90), check (longitude is null or longitude between -180 and 180)
);
create index addresses_user_idx on public.addresses(user_id);

create sequence public.order_number_seq start 10001;
create table public.orders (
  id uuid primary key default gen_random_uuid(), order_number text not null unique default ('CG-' || to_char(now(),'YYYYMMDD') || '-' || nextval('public.order_number_seq')),
  client_id uuid not null references public.profiles(id) on delete restrict, service_id uuid not null references public.cleaning_services(id),
  address_id uuid references public.addresses(id), city text not null, address_text text not null, scheduled_at timestamptz not null,
  area_sq_m integer not null check (area_sq_m > 0), rooms_count integer not null check (rooms_count > 0),
  comment text, photo_urls text[] not null default '{}', executor_preference public.executor_preference not null default 'any',
  selected_cleaner_id uuid references public.profiles(id), selected_company_id uuid references public.company_profiles(id),
  status public.order_status not null default 'created', payment_method public.payment_method not null,
  payment_status public.payment_status not null default 'pending', subtotal_minor bigint not null check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0), total_minor bigint not null check (total_minor >= 0),
  platform_fee_minor bigint not null default 0 check (platform_fee_minor >= 0), referral_reward_minor bigint not null default 0 check (referral_reward_minor >= 0),
  executor_amount_minor bigint not null default 0 check (executor_amount_minor >= 0), completed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index orders_client_idx on public.orders(client_id, created_at desc);
create index orders_status_schedule_idx on public.orders(status, scheduled_at);
create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  service_option_id uuid references public.service_options(id), name text not null, quantity integer not null default 1 check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0), total_minor bigint not null check (total_minor >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items(order_id);
create table public.order_status_history (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status, to_status public.order_status not null, changed_by uuid references public.profiles(id), note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history(order_id, created_at);
create table public.order_assignments (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  cleaner_id uuid references public.profiles(id), company_id uuid references public.company_profiles(id), assigned_by uuid references public.profiles(id),
  is_active boolean not null default true, accepted_at timestamptz, ended_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (cleaner_id is not null or company_id is not null)
);
create unique index one_active_assignment_per_order on public.order_assignments(order_id) where is_active;
create index order_assignments_cleaner_idx on public.order_assignments(cleaner_id) where is_active;
create table public.cleaner_availability (
  id uuid primary key default gen_random_uuid(), cleaner_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), starts_at time not null, ends_at time not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (ends_at > starts_at), unique(cleaner_id, weekday, starts_at)
);
create table public.cleaner_locations (
  id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders(id) on delete cascade,
  cleaner_id uuid not null references public.profiles(id) on delete cascade, latitude numeric(9,6) not null check(latitude between -90 and 90),
  longitude numeric(9,6) not null check(longitude between -180 and 180), heading numeric(6,2), speed numeric(8,2),
  recorded_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index cleaner_locations_cleaner_idx on public.cleaner_locations(cleaner_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders(id) on delete restrict,
  client_id uuid not null references public.profiles(id), cleaner_id uuid references public.profiles(id), company_id uuid references public.company_profiles(id),
  rating smallint not null check (rating between 1 and 5), text text, tags text[] not null default '{}', is_visible boolean not null default true,
  moderated_by uuid references public.profiles(id), moderated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (cleaner_id is not null or company_id is not null)
);
create index reviews_cleaner_idx on public.reviews(cleaner_id) where is_visible;
create index reviews_company_idx on public.reviews(company_id) where is_visible;
create table public.review_photos (
  id uuid primary key default gen_random_uuid(), review_id uuid not null references public.reviews(id) on delete cascade, storage_path text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.referral_codes (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references public.profiles(id) on delete cascade,
  code text not null unique, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.referrals (
  id uuid primary key default gen_random_uuid(), referrer_id uuid not null references public.profiles(id), referred_user_id uuid not null unique references public.profiles(id),
  code_id uuid not null references public.referral_codes(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(referrer_id <> referred_user_id)
);
create index referrals_referrer_idx on public.referrals(referrer_id);
create table public.wallets (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references public.profiles(id) on delete cascade,
  available_minor bigint not null default 0 check(available_minor >= 0), pending_minor bigint not null default 0 check(pending_minor >= 0), currency char(3) not null default 'KZT',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.referral_rewards (
  id uuid primary key default gen_random_uuid(), referral_id uuid not null references public.referrals(id), order_id uuid not null unique references public.orders(id),
  beneficiary_id uuid not null references public.profiles(id), referred_user_id uuid not null unique references public.profiles(id),
  amount_minor bigint not null check(amount_minor > 0), percent_bps integer not null check(percent_bps between 0 and 10000), status public.reward_status not null default 'available',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index referral_rewards_beneficiary_idx on public.referral_rewards(beneficiary_id, created_at desc);
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.wallets(id), owner_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id), reward_id uuid references public.referral_rewards(id), type public.wallet_transaction_type not null,
  amount_minor bigint not null check(amount_minor <> 0), balance_after_minor bigint not null check(balance_after_minor >= 0), description text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index wallet_transactions_owner_idx on public.wallet_transactions(owner_id, created_at desc);
create table public.platform_settings (
  id boolean primary key default true check(id), platform_fee_bps integer not null default 1500 check(platform_fee_bps between 0 and 10000),
  referral_fee_bps integer not null default 500 check(referral_fee_bps between 0 and 10000), minimum_order_minor bigint not null default 500000,
  company_registration_minor bigint not null default 0, subscription_minor bigint not null default 0, free_period_days integer not null default 30,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.platform_settings(id) values (true);

create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, order_id uuid references public.orders(id),
  type text not null, title text not null, body text not null, data jsonb not null default '{}', read_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create table public.disputes (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), opened_by uuid not null references public.profiles(id),
  reason text not null check(reason in ('cleaner_no_show','client_unresponsive','poor_quality','property_damage','incorrect_price','other')),
  description text, status public.dispute_status not null default 'open', assigned_admin_id uuid references public.profiles(id), resolution text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index disputes_status_idx on public.disputes(status, created_at);
create table public.dispute_messages (
  id uuid primary key default gen_random_uuid(), dispute_id uuid not null references public.disputes(id) on delete cascade,
  sender_id uuid not null references public.profiles(id), message text not null, attachment_urls text[] not null default '{}', is_admin_note boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.company_profiles(id) on delete cascade,
  status public.subscription_status not null default 'free', starts_at timestamptz, ends_at timestamptz, amount_minor bigint not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index subscriptions_company_idx on public.subscriptions(company_id, created_at desc);
create table public.verification_documents (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id), company_id uuid references public.company_profiles(id),
  document_type text not null, storage_path text not null, status public.document_status not null default 'pending', reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index verification_documents_owner_idx on public.verification_documents(owner_id);
create table public.admin_action_logs (
  id uuid primary key default gen_random_uuid(), admin_id uuid not null references public.profiles(id), action text not null,
  entity_type text not null, entity_id uuid, old_data jsonb, new_data jsonb, ip_address inet,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index admin_action_logs_admin_idx on public.admin_action_logs(admin_id, created_at desc);

do $$ declare t text; begin foreach t in array array['profiles','client_profiles','cleaner_profiles','company_profiles','company_cleaners','cleaning_services','service_options','addresses','orders','order_items','order_assignments','cleaner_locations','reviews','referral_codes','wallets','referral_rewards','platform_settings','notifications','disputes','dispute_messages','subscriptions','verification_documents'] loop execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t); end loop; end $$;

alter publication supabase_realtime add table public.orders, public.cleaner_locations, public.notifications;
