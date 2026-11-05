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
