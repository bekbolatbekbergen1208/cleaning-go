-- Availability and shift deadlines are changed only through set_cleaner_workday.
-- A normal cleaner profile UPDATE must not extend tracking past the chosen end.
create or replace function public.guard_cleaner_workday_fields()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_user='authenticated' and not public.is_admin() then
    new.is_available:=old.is_available;
    new.workday_ends_at:=old.workday_ends_at;
  end if;
  return new;
end; $$;
drop trigger if exists guard_cleaner_workday_fields on public.cleaner_profiles;
create trigger guard_cleaner_workday_fields before update on public.cleaner_profiles
for each row execute function public.guard_cleaner_workday_fields();
