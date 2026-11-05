-- Section markers for rehearsal tracks (where each chart section starts in the audio).
-- Run AFTER 003_charts_trainings.sql. Safe to run more than once.
alter table song_files add column if not exists markers jsonb not null default '{}'::jsonb;
