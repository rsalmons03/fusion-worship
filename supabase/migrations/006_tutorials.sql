-- Tutorial videos per song (e.g. drum, bass, keys walkthroughs). Safe to run more than once.
alter table songs add column if not exists tutorials jsonb not null default '[]'::jsonb;
