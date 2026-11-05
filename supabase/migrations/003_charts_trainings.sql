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
