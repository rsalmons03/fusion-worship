-- Personality / gifting results (Enneagram, Working Genius, spiritual gifts, DISC, CliftonStrengths, Myers-Briggs).
-- One row per person per assessment. People see and edit their own; leaders see and edit everyone's.
-- Run AFTER 002_locations.sql. Safe to run more than once.
create table if not exists assessments (
  profile_id uuid not null references profiles on delete cascade,
  kind text not null check (kind in ('enneagram', 'working_genius', 'spiritual_gifts', 'disc', 'strengths', 'mbti')),
  data jsonb not null default '{}',
  taken_on date,
  updated_at timestamptz not null default now(),
  primary key (profile_id, kind)
);
alter table assessments enable row level security;
drop policy if exists "assessments read" on assessments;
create policy "assessments read" on assessments for select using (profile_id = auth.uid() or is_leader());
drop policy if exists "assessments write" on assessments;
create policy "assessments write" on assessments for all using (profile_id = auth.uid() or is_leader()) with check (profile_id = auth.uid() or is_leader());
