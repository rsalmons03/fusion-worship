-- ALL database updates (002 → 014) in one file. Safe to run more than once:
-- anything already done is skipped. Supabase → SQL Editor → New query → paste ALL → Run.

-- ═══════════ 002_locations.sql ═══════════
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

-- ═══════════ 003_charts_trainings.sql ═══════════
-- MultiTracks links, PDF charts, trainings. Run AFTER 002_locations.sql. Safe to run more than once.

-- ── Songs: MultiTracks / ChartBuilder link ──
alter table songs add column if not exists multitracks_url text;

-- ── PDF charts attached to songs (files live in the private "charts" storage bucket) ──
create table if not exists song_files (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references songs on delete cascade,
  name text not null,
  path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists song_files_song_idx on song_files (song_id);
alter table song_files enable row level security;
drop policy if exists "song_files read" on song_files;
create policy "song_files read" on song_files for select using (is_active());
drop policy if exists "song_files write" on song_files;
create policy "song_files write" on song_files for all using (is_leader()) with check (is_leader());

insert into storage.buckets (id, name, public) values ('charts', 'charts', false)
on conflict (id) do nothing;
drop policy if exists "charts read" on storage.objects;
create policy "charts read" on storage.objects for select using (bucket_id = 'charts' and is_active());
drop policy if exists "charts insert" on storage.objects;
create policy "charts insert" on storage.objects for insert with check (bucket_id = 'charts' and is_leader());
drop policy if exists "charts update" on storage.objects;
create policy "charts update" on storage.objects for update using (bucket_id = 'charts' and is_leader());
drop policy if exists "charts delete" on storage.objects;
create policy "charts delete" on storage.objects for delete using (bucket_id = 'charts' and is_leader());

-- ── Trainings ──
create table if not exists trainings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  url text,
  team_id uuid references teams on delete set null,       -- empty = everyone
  location_id uuid references locations on delete set null, -- empty = all locations
  required boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists training_completions (
  training_id uuid not null references trainings on delete cascade,
  profile_id uuid not null references profiles on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (training_id, profile_id)
);
alter table trainings enable row level security;
alter table training_completions enable row level security;

drop policy if exists "trainings read" on trainings;
create policy "trainings read" on trainings for select using (is_active() and can_see_location(location_id));
drop policy if exists "trainings write" on trainings;
create policy "trainings write" on trainings for all
  using (is_leader() and can_edit_location(location_id))
  with check (is_leader() and can_edit_location(location_id));

drop policy if exists "training_completions read" on training_completions;
create policy "training_completions read" on training_completions for select using (is_active());
drop policy if exists "training_completions write" on training_completions;
create policy "training_completions write" on training_completions for all
  using (is_active() and (profile_id = auth.uid() or is_leader()))
  with check (is_active() and (profile_id = auth.uid() or is_leader()));

-- ═══════════ 004_section_markers.sql ═══════════
-- Section markers for rehearsal tracks (where each chart section starts in the audio).
-- Run AFTER 003_charts_trainings.sql. Safe to run more than once.
alter table song_files add column if not exists markers jsonb not null default '{}'::jsonb;

-- ═══════════ 005_stems.sql ═══════════
-- Stems: audio files that play together in the mixer (Click, Guide, Drums, Bass…).
-- Run AFTER 004_section_markers.sql. Safe to run more than once.
alter table song_files add column if not exists is_stem boolean not null default false;

-- ═══════════ 006_tutorials.sql ═══════════
-- Tutorial videos per song (e.g. drum, bass, keys walkthroughs). Safe to run more than once.
alter table songs add column if not exists tutorials jsonb not null default '[]'::jsonb;

-- ═══════════ 007_plan_times.sql ═══════════
-- Service, rehearsal and other times for a plan. Run AFTER 002_locations.sql. Safe to run more than once.
create table if not exists plan_times (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans on delete cascade,
  kind text not null default 'service' check (kind in ('service', 'rehearsal', 'other')),
  label text,
  day date not null,
  starts time,
  ends time,
  created_at timestamptz not null default now()
);
create index if not exists plan_times_plan_idx on plan_times (plan_id, day, starts);
alter table plan_times enable row level security;
drop policy if exists "plan_times read" on plan_times;
create policy "plan_times read" on plan_times for select using (is_active() and can_see_plan(plan_id));
drop policy if exists "plan_times write" on plan_times;
create policy "plan_times write" on plan_times for all
  using (is_leader() and can_edit_plan(plan_id))
  with check (is_leader() and can_edit_plan(plan_id));

-- ═══════════ 008_verified.sql ═══════════
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

-- ═══════════ 009_attendance.sql ═══════════
-- Attendance (here / no-show) for each scheduled person, and "member since" dates.
-- Run AFTER 008_verified.sql. Safe to run more than once.
alter table assignments add column if not exists attendance text check (attendance in ('present', 'no_show'));
alter table profiles add column if not exists member_since date;

-- Members may only accept/decline their own request; attendance is marked by leaders.
create or replace function protect_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_leader() then
    if new.plan_id <> old.plan_id or new.position_id <> old.position_id
       or new.profile_id <> old.profile_id or new.status not in ('accepted', 'declined')
       or new.attendance is distinct from old.attendance then
      raise exception 'You can only accept or decline your own request';
    end if;
    new.responded_at := now();
  end if;
  return new;
end $$;

-- Only admins may change roles, locations, the confirmed check or member-since dates.
create or replace function protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.location_id is distinct from old.location_id
      or new.verified is distinct from old.verified
      or new.member_since is distinct from old.member_since)
     and not is_admin() and auth.uid() is not null then
    raise exception 'Only an admin can change roles, locations, the confirmed check or member-since dates';
  end if;
  return new;
end $$;

-- ═══════════ 010_templates.sql ═══════════
-- Order-of-service templates (e.g. "Newfield standard"). New plans can start from one.
-- Run AFTER 002_locations.sql. Safe to run more than once.
create table if not exists order_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_id uuid references locations on delete cascade,
  is_default boolean not null default false,
  start_time time,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table order_templates enable row level security;
drop policy if exists "order_templates read" on order_templates;
create policy "order_templates read" on order_templates for select using (is_active() and can_see_location(location_id));
drop policy if exists "order_templates write" on order_templates;
create policy "order_templates write" on order_templates for all
  using (is_leader() and can_edit_location(location_id))
  with check (is_leader() and can_edit_location(location_id));

-- Newfield's standard order (only added once).
insert into order_templates (name, location_id, is_default, start_time, items)
select 'Newfield standard', l.id, true, '07:15', $json$[{"kind": "header", "title": "Pre service", "duration_min": null, "description": null}, {"kind": "item", "title": "Call time", "duration_min": 15, "description": "- 7:15 AM - Arrival Time\n- 7:30 AM - Start Time"}, {"kind": "item", "title": "Sound check + run-through", "duration_min": 50, "description": "- 7:30 AM - 7:40 AM - Band + Vocal Check\n- 7:40-8:00AM - Full Worship + Production Run-through\n- 8:00-8:20AM - Transition Run-through w/ Generosity, CN, Host + Resi Check"}, {"kind": "item", "title": "Team prayer", "duration_min": 10, "description": "- 8:20 AM - 8:30 AM"}, {"kind": "item", "title": "Preservice slides", "duration_min": 30, "description": "- Double check that everyone is ready and know what they need to know\n- Check battery levels\n- Bathroom break\n- Be in positions before the countdown"}, {"kind": "item", "title": "Countdown", "duration_min": 5, "description": "- Everyone in position and ready to go\n- Great time for team to pray for the service"}, {"kind": "header", "title": "Worship", "duration_min": null, "description": null}, {"kind": "item", "title": "Song 1", "duration_min": 0, "description": "NAME\nSp: \nAl: \nMel/Ten: "}, {"kind": "item", "title": "Song 2", "duration_min": 0, "description": "NAME\nSp: \nAl: \nMel/Ten: "}, {"kind": "item", "title": "Worship scripture", "duration_min": 0, "description": "Book Chapter:Verse (Version)\n- Check with Worship Pastor to see if there is scripture\n- Replace with Communion or Baptism scripture as needed (also move it to after Song 1 if so)"}, {"kind": "item", "title": "Song 3", "duration_min": 0, "description": "NAME\nSp: \nAl: \nMel/Ten: "}, {"kind": "item", "title": "Song 4 Tag", "duration_min": 0, "description": "NAME\nSp: \nAl: \nMel/Ten: "}, {"kind": "item", "title": "Worship clock", "duration_min": 22, "description": null}, {"kind": "header", "title": "Transition", "duration_min": null, "description": null}, {"kind": "item", "title": "Generosity moment", "duration_min": 4, "description": null}, {"kind": "item", "title": "Church news", "duration_min": 3, "description": "- Check to see if Resi or ProPresenter"}, {"kind": "header", "title": "The Word", "duration_min": null, "description": null}, {"kind": "item", "title": "Weekend message", "duration_min": 30, "description": "- Stream in via Resi"}, {"kind": "header", "title": "Closing", "duration_min": null, "description": null}, {"kind": "item", "title": "Closing song", "duration_min": 0, "description": "- Work with Worship Pastor to determine closing song"}, {"kind": "item", "title": "Closing song clock", "duration_min": 3, "description": null}, {"kind": "item", "title": "Salvation prayer + closing", "duration_min": 5, "description": null}, {"kind": "header", "title": "After service", "duration_min": null, "description": null}]$json$::jsonb
from locations l
where l.name = 'Newfield'
  and not exists (select 1 from order_templates t where t.name = 'Newfield standard');

-- ═══════════ 011_seconds_eggharbor.sql ═══════════
-- Lengths with seconds (e.g. 4:56) in the order of service, and the Egg Harbor standard template.
-- Run AFTER 010_templates.sql. Safe to run more than once.
alter table plan_items add column if not exists duration_sec int check (duration_sec >= 0);
update plan_items set duration_sec = duration_min * 60 where duration_sec is null and duration_min is not null;

insert into order_templates (name, location_id, is_default, start_time, items)
select 'Egg Harbor standard', l.id, true, '06:45', $json$[{"kind": "header", "title": "Rehearsal", "duration_min": null, "duration_sec": null, "description": null}, {"kind": "item", "title": "Call Time", "duration_min": 15, "duration_sec": 900, "description": "- 6:45 AM: Band & Audio Arrival\n- 7:00 AM: Line checks & Vocals\n- 7:15 AM: Ready to go"}, {"kind": "item", "title": "Worship Run-through", "duration_min": 20, "duration_sec": 1200, "description": "7:20-8:00AM - Full Production Run-through"}, {"kind": "item", "title": "Generosity Run-through", "duration_min": 4, "duration_sec": 240, "description": "8:00 am - 8:04 am"}, {"kind": "item", "title": "Church News Run-through", "duration_min": 3, "duration_sec": 180, "description": "8:04 am - 8:07 am"}, {"kind": "item", "title": "Host + Resi Sound Check", "duration_min": 13, "duration_sec": 780, "description": "- Review stage setup: TV, table, props/items on table, etc.\n- Headset or handheld mic?\n- Speaker good with floor monitors?\n- Are remote locations getting audio?"}, {"kind": "item", "title": "Team Prayer", "duration_min": 10, "duration_sec": 600, "description": "8:20 AM Lobby"}, {"kind": "item", "title": "Worship", "duration_min": 0, "duration_sec": 0, "description": "8:30 AM Worship in the green room for Worship team"}, {"kind": "header", "title": "Pre service", "duration_min": null, "duration_sec": null, "description": null}, {"kind": "item", "title": "Preservice Slides", "duration_min": 25, "duration_sec": 1500, "description": "- Double check that everyone is ready and know what they need to know\n- Check battery levels\n- Bathroom break\n- Be in positions before the countdown"}, {"kind": "item", "title": "Countdown", "duration_min": 5, "duration_sec": 300, "description": "- Everyone in position and ready to go\n- Great time for team to pray for the service"}, {"kind": "header", "title": "Worship", "duration_min": null, "duration_sec": null, "description": null}, {"kind": "item", "title": "Song 1 – Praise", "duration_min": 5, "duration_sec": 296, "description": "G\nCLAY"}, {"kind": "item", "title": "Song 2 – Who Else", "duration_min": 5, "duration_sec": 315, "description": "C\nCLAY"}, {"kind": "item", "title": "Communion", "duration_min": 0, "duration_sec": 0, "description": "- Check with Worship Pastor to see if there is scripture\n- Replace with Communion or Baptism scripture as needed"}, {"kind": "item", "title": "Song 3 – What a God (Extended)", "duration_min": 13, "duration_sec": 759, "description": "A\nNIKKI & CLAY"}, {"kind": "item", "title": "Worship Clock", "duration_min": 20, "duration_sec": 1200, "description": "Worship Leader will pray out before Generosity Speaker begins."}, {"kind": "header", "title": "Transition", "duration_min": null, "duration_sec": null, "description": null}, {"kind": "item", "title": "Closing | Meet & Greet", "duration_min": 1, "duration_sec": 60, "description": "CLAY\nWorship Leader will pray to end worship & cover meet & greet as we transition to Generosity Moment"}, {"kind": "item", "title": "Generosity Moment", "duration_min": 4, "duration_sec": 240, "description": "Firsts Teaching"}, {"kind": "item", "title": "Church News", "duration_min": 3, "duration_sec": 201, "description": "Intro\nTrunk or Treat--we need trunks + candy\nSisterhood v2\n1729\nlogo"}, {"kind": "header", "title": "The Word", "duration_min": null, "duration_sec": null, "description": null}, {"kind": "item", "title": "Weekend Message", "duration_min": 30, "duration_sec": 1800, "description": "- Streamed online and to remote locations\n- Remote locations cut at \"Amen\" on closing prayer\n- Check for special pictures/videos to be shown/played in message"}, {"kind": "header", "title": "Closing", "duration_min": null, "duration_sec": null, "description": null}, {"kind": "item", "title": "Closing Song | Who Else", "duration_min": 0, "duration_sec": 0, "description": "Bridge and Chorus\n\nWork with Worship Pastor to determine closing song\nNAME\nSp: \nAl: \nMel/Ten: "}, {"kind": "item", "title": "Closing Song Clock", "duration_min": 3, "duration_sec": 180, "description": null}, {"kind": "item", "title": "Salvation Prayer + Closing", "duration_min": 5, "duration_sec": 300, "description": null}]$json$::jsonb
from locations l
where l.name = 'Egg Harbor'
  and not exists (select 1 from order_templates t where t.name = 'Egg Harbor standard');

-- ═══════════ 012_vocals.sql ═══════════
-- Positions that need several people (e.g. 3 backup vocals), and positions someone can
-- "double up" on alongside an instrument in the same service (vocals).
-- Adds Lead Vocals + Backup Vocals to Worship Band teams. Safe to run more than once.
alter table positions add column if not exists needed int not null default 1 check (needed between 1 and 20);
alter table positions add column if not exists can_double boolean not null default false;

-- Singing can be done alongside playing.
update positions set can_double = true
where can_double = false and (name ilike '%vocal%' or name ilike '%bgv%' or name ilike '%vox%' or name ilike '%singer%' or name ilike '%choir%' or name ilike 'worship leader%'
       or name ilike '%director%' or name ilike 'md' or name ilike 'music director%');

-- A plain "Vocals" position becomes "Backup Vocals" (keeps everyone already on it).
update positions p set name = 'Backup Vocals', needed = greatest(p.needed, 3)
where p.name ilike 'vocals'
  and not exists (select 1 from positions q where q.team_id = p.team_id and q.name ilike 'backup vocals');

-- Lead + Backup Vocals on every Worship Band team that doesn't have them yet.
insert into positions (team_id, name, sort, needed, can_double)
select t.id, 'Lead Vocals', 1, 1, true from teams t
where t.name ilike 'worship%band%' and not exists (select 1 from positions p where p.team_id = t.id and p.name ilike 'lead vocal%');
insert into positions (team_id, name, sort, needed, can_double)
select t.id, 'Backup Vocals', 2, 3, true from teams t
where t.name ilike 'worship%band%' and not exists (select 1 from positions p where p.team_id = t.id and p.name ilike 'backup vocal%');

-- ═══════════ 013_position_levels.sql ═══════════
-- How much of a position's rotation each person takes:
--   1 = main, 0.5 = about half as often, 0 = only if needed.
-- Run AFTER 002_locations.sql. Safe to run more than once.
alter table position_members add column if not exists weight numeric not null default 1 check (weight >= 0 and weight <= 1);

-- ═══════════ 014_stem_jobs.sql ═══════════
-- Stem-splitting jobs (Replicate / Demucs). The server creates and updates these; leaders can see them.
-- Run AFTER 005_stems.sql. Safe to run more than once.
create table if not exists stem_jobs (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references songs on delete cascade,
  file_id uuid not null references song_files on delete cascade,
  prediction_id text,
  status text not null default 'starting', -- starting | processing | succeeded | importing | done | failed
  error text,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stem_jobs_song_idx on stem_jobs (song_id, created_at desc);
alter table stem_jobs enable row level security;
drop policy if exists "stem_jobs read" on stem_jobs;
create policy "stem_jobs read" on stem_jobs for select using (is_leader());

-- Make the app see the changes right away
notify pgrst, 'reload schema';
-- ✅ Finished: all updates applied
