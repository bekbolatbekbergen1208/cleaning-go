create function public.make_company_code() returns text
language sql volatile set search_path = '' as $$
  select 'CGC-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
$$;

alter table public.company_profiles
  add column if not exists company_code text unique default public.make_company_code();

update public.company_profiles
set company_code = public.make_company_code()
where company_code is null;

alter table public.company_profiles alter column company_code set not null;

alter table public.client_profiles
  add column if not exists preferred_company_id uuid references public.company_profiles(id) on delete set null;

create index if not exists client_profiles_preferred_company_idx
  on public.client_profiles(preferred_company_id)
  where preferred_company_id is not null;

create index if not exists company_profiles_code_idx
  on public.company_profiles(company_code);

-- Пользователь может проверить код компании до регистрации через безопасную RPC.
create function public.find_company_by_code(input_code text)
returns table(id uuid, name text, logo_url text, city text, rating numeric)
language sql stable security definer set search_path=public as $$
  select c.id,c.name,c.logo_url,c.service_cities[1],c.rating
  from company_profiles c
  where c.company_code=upper(trim(input_code))
    and c.verification_status in ('pending','approved');
$$;
grant execute on function public.find_company_by_code(text) to anon,authenticated;
