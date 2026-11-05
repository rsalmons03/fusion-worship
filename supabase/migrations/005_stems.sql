-- Stems: audio files that play together in the mixer (Click, Guide, Drums, Bass…).
-- Run AFTER 004_section_markers.sql. Safe to run more than once.
alter table song_files add column if not exists is_stem boolean not null default false;
