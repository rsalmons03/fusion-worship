-- Locations (campuses). Safe to run more than once.
-- Run in Supabase: SQL Editor -> New query -> paste ALL of this file -> Run.

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int not null default 0
);
insert into locations (name, sort) values ('Newfield', 1), ('Egg Harbor', 2), ('Ventnor', 3)
on conflict (name) do nothing;

-- A person's location. Empty = sees all locations.
alter table profiles add column if not exists location_id uuid references locations on delete set null;
-- Each plan belongs to a location.
alter table plans add column if not exists location_id uuid references locations on delete set null;
-- A team belongs to one location, or is shared by all (empty).
alter table teams add column if not exists location_id uuid references locations on delete set null;
create index if not exists plans_location_idx on plans (location_id, service_date);

create or replace function my_location() returns uuid
language sql stable security definer set search_path = public as $$
  select location_id from profiles where id = auth.uid()
$$;

-- True when the signed-in person may see things at this location.
create or replace function can_see_location(loc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or my_location() is null or loc is null or loc = my_location()
$$;

-- True when the signed-in person may edit things at this location (shared = admins / all-location people only).
create or replace function can_edit_location(loc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or my_location() is null or loc = my_location()
$$;

-- True when the signed-in person may see this plan: its location, or they're scheduled on it.
create or replace function can_see_plan(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from plans p where p.id = pid
      and (can_see_location(p.location_id)
           or exists (select 1 from assignments a where a.plan_id = p.id and a.profile_id = auth.uid()))
  )
$$;

create or replace function can_edit_plan(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from plans p where p.id = pid and can_edit_location(p.location_id))
$$;
create or replace function can_edit_team(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams t where t.id = tid and can_edit_location(t.location_id))
$$;

-- Only admins may change roles or locations.
create or replace function protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.location_id is distinct from old.location_id)
     and not is_admin() and auth.uid() is not null then
    raise exception 'Only an admin can change roles or locations';
  end if;
  return new;
end $$;

alter table locations enable row level security;
drop policy if exists "locations read" on locations;
create policy "locations read" on locations for select using (is_active());
drop policy if exists "locations write" on locations;
create policy "locations write" on locations for all using (is_admin()) with check (is_admin());

drop policy if exists "plans read" on plans;
create policy "plans read" on plans for select using (is_active() and can_see_plan(id));
drop policy if exists "plans write" on plans;
create policy "plans write" on plans for all
  using (is_leader() and can_edit_location(location_id))
  with check (is_leader() and can_edit_location(location_id));

drop policy if exists "plan_items read" on plan_items;
create policy "plan_items read" on plan_items for select using (is_active() and can_see_plan(plan_id));
drop policy if exists "plan_items write" on plan_items;
create policy "plan_items write" on plan_items for all
  using (is_leader() and can_edit_plan(plan_id))
  with check (is_leader() and can_edit_plan(plan_id));

drop policy if exists "teams read" on teams;
create policy "teams read" on teams for select using (is_active() and can_see_location(location_id));
drop policy if exists "teams write" on teams;
create policy "teams write" on teams for all
  using (is_leader() and can_edit_location(location_id))
  with check (is_leader() and can_edit_location(location_id));

drop policy if exists "positions write" on positions;
create policy "positions write" on positions for all
  using (is_leader() and can_edit_team(team_id)) with check (is_leader() and can_edit_team(team_id));
drop policy if exists "position_members write" on position_members;
create policy "position_members write" on position_members for all
  using (is_leader() and exists (select 1 from positions p where p.id = position_id and can_edit_team(p.team_id)))
  with check (is_leader() and exists (select 1 from positions p where p.id = position_id and can_edit_team(p.team_id)));
