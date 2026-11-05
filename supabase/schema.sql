-- Worship Planner — database schema
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Access is enforced here with Row-Level Security, not in the UI:
--   admin   : everything, including people's roles
--   leader  : edit songs, plans, teams, schedules
--   member  : read everything, respond to their own requests, manage own block-outs
--   pending : signed in but not approved yet — sees nothing
-- The very first account to sign up becomes admin automatically.

create extension if not exists pgcrypto;

do $$ begin
  create type app_role as enum ('admin', 'leader', 'member', 'pending');
exception when duplicate_object then null; end $$;

-- ───────────────────────── People ─────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text not null default '',
  phone text,
  role app_role not null default 'pending',
  created_at timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when not exists (select 1 from profiles) then 'admin'::app_role else 'pending'::app_role end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;
create or replace function is_active() returns boolean language sql stable as $$
  select coalesce(my_role() in ('admin', 'leader', 'member'), false)
$$;
create or replace function is_leader() returns boolean language sql stable as $$
  select coalesce(my_role() in ('admin', 'leader'), false)
$$;
create or replace function is_admin() returns boolean language sql stable as $$
  select coalesce(my_role() = 'admin', false)
$$;

-- Only admins may change anyone's role (including their own).
create or replace function protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not is_admin() and auth.uid() is not null then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_role on profiles;
create trigger profiles_protect_role before update on profiles
  for each row execute function protect_role();

-- ───────────────────────── Songs ─────────────────────────
create table if not exists songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  ccli text,
  default_key text,
  bpm int,
  meter text,
  themes text,
  chordpro text not null default '',
  reference_url text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Plans ─────────────────────────
create table if not exists service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_time time
);

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  service_type_id uuid references service_types on delete set null,
  service_date date not null,
  start_time time,
  title text,
  series text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists plans_date_idx on plans (service_date);

create table if not exists plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans on delete cascade,
  position int not null default 0,
  kind text not null default 'item' check (kind in ('song', 'header', 'item')),
  title text not null default '',
  song_id uuid references songs on delete set null,
  song_key text,
  duration_min int,
  description text
);
create index if not exists plan_items_plan_idx on plan_items (plan_id, position);
create index if not exists plan_items_song_idx on plan_items (song_id);

-- ───────────────────────── Teams & scheduling ─────────────────────────
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort int not null default 0
);

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  name text not null,
  sort int not null default 0
);

-- Who is able to fill a position (the roster).
create table if not exists position_members (
  position_id uuid not null references positions on delete cascade,
  profile_id uuid not null references profiles on delete cascade,
  primary key (position_id, profile_id)
);

-- Who is scheduled to serve in a given plan.
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans on delete cascade,
  position_id uuid not null references positions on delete cascade,
  profile_id uuid not null references profiles on delete cascade,
  status text not null default 'unsent' check (status in ('unsent', 'pending', 'accepted', 'declined')),
  notified_at timestamptz,
  responded_at timestamptz,
  unique (plan_id, position_id, profile_id)
);
create index if not exists assignments_profile_idx on assignments (profile_id);

-- Secret per-request tokens for the accept/decline link in emails.
-- No RLS policies => only the server (service role) can read them.
create table if not exists assignment_tokens (
  assignment_id uuid primary key references assignments on delete cascade,
  token uuid not null unique default gen_random_uuid()
);
create or replace function make_assignment_token() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into assignment_tokens (assignment_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists assignments_token on assignments;
create trigger assignments_token after insert on assignments
  for each row execute function make_assignment_token();

-- Members may only change the status of their own request.
create or replace function protect_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_leader() then
    if new.plan_id <> old.plan_id or new.position_id <> old.position_id
       or new.profile_id <> old.profile_id or new.status not in ('accepted', 'declined') then
      raise exception 'You can only accept or decline your own request';
    end if;
    new.responded_at := now();
  end if;
  return new;
end $$;
drop trigger if exists assignments_protect on assignments;
create trigger assignments_protect before update on assignments
  for each row execute function protect_assignment();

create table if not exists blockouts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text,
  check (ends_on >= starts_on)
);

-- ───────────────────────── Row-Level Security ─────────────────────────
alter table profiles enable row level security;
alter table songs enable row level security;
alter table service_types enable row level security;
alter table plans enable row level security;
alter table plan_items enable row level security;
alter table teams enable row level security;
alter table positions enable row level security;
alter table position_members enable row level security;
alter table assignments enable row level security;
alter table assignment_tokens enable row level security;
alter table blockouts enable row level security;

drop policy if exists "profiles read" on profiles;
create policy "profiles read" on profiles for select using (is_active() or id = auth.uid());
drop policy if exists "profiles update self or admin" on profiles;
create policy "profiles update self or admin" on profiles for update
  using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());
drop policy if exists "profiles delete admin" on profiles;
create policy "profiles delete admin" on profiles for delete using (is_admin());

-- Tables everyone active can read and leaders can edit.
do $$
declare t text;
begin
  foreach t in array array['songs','service_types','plans','plan_items','teams','positions','position_members'] loop
    execute format('drop policy if exists "%1$s read" on %1$I', t);
    execute format('create policy "%1$s read" on %1$I for select using (is_active())', t);
    execute format('drop policy if exists "%1$s write" on %1$I', t);
    execute format('create policy "%1$s write" on %1$I for all using (is_leader()) with check (is_leader())', t);
  end loop;
end $$;

drop policy if exists "assignments read" on assignments;
create policy "assignments read" on assignments for select using (is_active());
drop policy if exists "assignments insert" on assignments;
create policy "assignments insert" on assignments for insert with check (is_leader());
drop policy if exists "assignments delete" on assignments;
create policy "assignments delete" on assignments for delete using (is_leader());
drop policy if exists "assignments update" on assignments;
create policy "assignments update" on assignments for update
  using (is_leader() or profile_id = auth.uid()) with check (is_leader() or profile_id = auth.uid());

drop policy if exists "blockouts read" on blockouts;
create policy "blockouts read" on blockouts for select using (is_active());
drop policy if exists "blockouts write" on blockouts;
create policy "blockouts write" on blockouts for all
  using (is_active() and (profile_id = auth.uid() or is_leader()))
  with check (is_active() and (profile_id = auth.uid() or is_leader()));

-- ───────────────────────── Starter data ─────────────────────────
insert into service_types (name, default_time)
select 'Sunday Morning', '10:00' where not exists (select 1 from service_types);

do $$
declare w uuid; p uuid;
begin
  if not exists (select 1 from teams) then
    insert into teams (name, sort) values ('Worship Band', 1) returning id into w;
    insert into positions (team_id, name, sort) values
      (w, 'Worship Leader', 1), (w, 'Vocals', 2), (w, 'Acoustic Guitar', 3),
      (w, 'Electric Guitar', 4), (w, 'Keys', 5), (w, 'Bass', 6), (w, 'Drums', 7);
    insert into teams (name, sort) values ('Production', 2) returning id into p;
    insert into positions (team_id, name, sort) values
      (p, 'Sound', 1), (p, 'Lyrics / Slides', 2), (p, 'Livestream', 3), (p, 'Lighting', 4);
  end if;
end $$;
