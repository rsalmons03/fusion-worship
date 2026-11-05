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
