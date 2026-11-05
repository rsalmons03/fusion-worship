-- "Confirmed member" check mark for reliable people. Only admins can give or remove it.
-- Run AFTER 002_locations.sql. Safe to run more than once.
alter table profiles add column if not exists verified boolean not null default false;

create or replace function protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.location_id is distinct from old.location_id
      or new.verified is distinct from old.verified)
     and not is_admin() and auth.uid() is not null then
    raise exception 'Only an admin can change roles, locations or the confirmed check';
  end if;
  return new;
end $$;
