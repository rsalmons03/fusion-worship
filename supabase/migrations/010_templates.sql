-- Order-of-service templates (e.g. "Newfield standard"). New plans can start from one.
-- Run AFTER 002_locations.sql. Safe to run more than once.
create table if not exists order_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_id uuid references locations on delete cascade,
  is_default boolean not null default false,
  start_time time,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table order_templates enable row level security;
drop policy if exists "order_templates read" on order_templates;
create policy "order_templates read" on order_templates for select using (is_active() and can_see_location(location_id));
drop policy if exists "order_templates write" on order_templates;
create policy "order_templates write" on order_templates for all
  using (is_leader() and can_edit_location(location_id))
  with check (is_leader() and can_edit_location(location_id));

-- Newfield's standard order (only added once).
insert into order_templates (name, location_id, is_default, start_time, items)
select 'Newfield standard', l.id, true, '07:15', $json$[{"kind": "header", "title": "Pre service", "duration_min": null, "description": null}, {"kind": "item", "title": "Call time", "duration_min": 15, "description": "- 7:15 AM - Arrival Time\n- 7:30 AM - Start Time"}, {"kind": "item", "title": "Sound check + run-through", "duration_min": 50, "description": "- 7:30 AM - 7:40 AM - Band + Vocal Check\n- 7:40-8:00AM - Full Worship + Production Run-through\n- 8:00-8:20AM - Transition Run-through w/ Generosity, CN, Host + Resi Check"}, {"kind": "item", "title": "Team prayer", "duration_min": 10, "description": "- 8:20 AM - 8:30 AM"}, {"kind": "item", "title": "Preservice slides", "duration_min": 30, "description": "- Double check that everyone is ready and know what they need to know\n- Check battery levels\n- Bathroom break\n- Be in positions before the countdown"}, {"kind": "item", "title": "Countdown", "duration_min": 5, "description": "- Everyone in position and ready to go\n- Great time for team to pray for the service"}, {"kind": "header", "title": "Worship", "duration_min": null, "description": null}, {"kind": "item", "title": "Song 1", "duration_min": 0, "description": "NAME\nSp: \nAl: \nMel/Ten: "}, {"kind": "item", "title": "Song 2", "duration_min": 0, "description": "NAME\nSp: \nAl: \nMel/Ten: "}, {"kind": "item", "title": "Worship scripture", "duration_min": 0, "description": "Book Chapter:Verse (Version)\n- Check with Worship Pastor to see if there is scripture\n- Replace with Communion or Baptism scripture as needed (also move it to after Song 1 if so)"}, {"kind": "item", "title": "Song 3", "duration_min": 0, "description": "NAME\nSp: \nAl: \nMel/Ten: "}, {"kind": "item", "title": "Song 4 Tag", "duration_min": 0, "description": "NAME\nSp: \nAl: \nMel/Ten: "}, {"kind": "item", "title": "Worship clock", "duration_min": 22, "description": null}, {"kind": "header", "title": "Transition", "duration_min": null, "description": null}, {"kind": "item", "title": "Generosity moment", "duration_min": 4, "description": null}, {"kind": "item", "title": "Church news", "duration_min": 3, "description": "- Check to see if Resi or ProPresenter"}, {"kind": "header", "title": "The Word", "duration_min": null, "description": null}, {"kind": "item", "title": "Weekend message", "duration_min": 30, "description": "- Stream in via Resi"}, {"kind": "header", "title": "Closing", "duration_min": null, "description": null}, {"kind": "item", "title": "Closing song", "duration_min": 0, "description": "- Work with Worship Pastor to determine closing song"}, {"kind": "item", "title": "Closing song clock", "duration_min": 3, "description": null}, {"kind": "item", "title": "Salvation prayer + closing", "duration_min": 5, "description": null}, {"kind": "header", "title": "After service", "duration_min": null, "description": null}]$json$::jsonb
from locations l
where l.name = 'Newfield'
  and not exists (select 1 from order_templates t where t.name = 'Newfield standard');
