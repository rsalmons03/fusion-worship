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
