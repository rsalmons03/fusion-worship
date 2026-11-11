-- Per service: whether each position is needed that day (set by leaders in the Scheduler).
--   needed (default when there's no row) | optional = nice to have | tracks = covered by tracks | not_needed
-- Run AFTER 002_locations.sql. Safe to run more than once.
create table if not exists plan_position_needs (
  plan_id uuid not null references plans on delete cascade,
  position_id uuid not null references positions on delete cascade,
  status text not null default 'needed' check (status in ('needed', 'optional', 'tracks', 'not_needed')),
  updated_by uuid references profiles on delete set null,
  updated_at timestamptz not null default now(),
  primary key (plan_id, position_id)
);
alter table plan_position_needs enable row level security;
drop policy if exists "plan_position_needs read" on plan_position_needs;
create policy "plan_position_needs read" on plan_position_needs for select using (auth.uid() is not null);
drop policy if exists "plan_position_needs write" on plan_position_needs;
create policy "plan_position_needs write" on plan_position_needs for all using (is_leader()) with check (is_leader());
