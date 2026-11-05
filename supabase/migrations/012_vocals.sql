-- Positions that need several people (e.g. 3 backup vocals), and positions someone can
-- "double up" on alongside an instrument in the same service (vocals).
-- Adds Lead Vocals + Backup Vocals to Worship Band teams. Safe to run more than once.
alter table positions add column if not exists needed int not null default 1 check (needed between 1 and 20);
alter table positions add column if not exists can_double boolean not null default false;

-- Singing can be done alongside playing.
update positions set can_double = true
where can_double = false and (name ilike '%vocal%' or name ilike '%bgv%' or name ilike '%vox%' or name ilike '%singer%' or name ilike '%choir%' or name ilike 'worship leader%'
       or name ilike '%director%' or name ilike 'md' or name ilike 'music director%');

-- A plain "Vocals" position becomes "Backup Vocals" (keeps everyone already on it).
update positions p set name = 'Backup Vocals', needed = greatest(p.needed, 3)
where p.name ilike 'vocals'
  and not exists (select 1 from positions q where q.team_id = p.team_id and q.name ilike 'backup vocals');

-- Lead + Backup Vocals on every Worship Band team that doesn't have them yet.
insert into positions (team_id, name, sort, needed, can_double)
select t.id, 'Lead Vocals', 1, 1, true from teams t
where t.name ilike 'worship%band%' and not exists (select 1 from positions p where p.team_id = t.id and p.name ilike 'lead vocal%');
insert into positions (team_id, name, sort, needed, can_double)
select t.id, 'Backup Vocals', 2, 3, true from teams t
where t.name ilike 'worship%band%' and not exists (select 1 from positions p where p.team_id = t.id and p.name ilike 'backup vocal%');
