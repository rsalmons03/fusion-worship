-- How much of a position's rotation each person takes:
--   1 = main, 0.5 = about half as often, 0 = only if needed.
-- Run AFTER 002_locations.sql. Safe to run more than once.
alter table position_members add column if not exists weight numeric not null default 1 check (weight >= 0 and weight <= 1);
