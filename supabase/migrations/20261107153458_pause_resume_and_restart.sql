alter table public.rooms add column if not exists generation integer not null default 0;
alter table public.submissions add column if not exists generation integer not null default 0;

create or replace function private.require_open_submission() returns trigger
language plpgsql security invoker set search_path='' as $$
declare event public.rooms%rowtype;
begin
 select * into event from public.rooms where id=new.room_id for update;
 if not found or new.generation<>event.generation or not (
   (event.status='running' and event.ends_at is not null and clock_timestamp()<event.ends_at)
   or (event.status='paused' and event.remaining_seconds>0)
 ) then raise exception 'Submission is closed' using errcode='P0001'; end if;
 new.updated_at:=clock_timestamp(); return new;
end $$;

create or replace function public.change_event_timer(p_room_id uuid,p_command text,p_seconds integer default null)
returns public.rooms language plpgsql security invoker set search_path='' as $$
declare r public.rooms; seconds integer;
begin
 select * into r from public.rooms where id=p_room_id for update;
 if not found then raise exception 'Room missing'; end if;
 if p_command='start' then
  seconds:=case when r.status='paused' and r.remaining_seconds>0 then r.remaining_seconds else p_seconds end;
  if seconds is null or seconds<1 or seconds>86400 then raise exception 'Invalid duration'; end if;
  update public.rooms set status='running',ends_at=clock_timestamp()+make_interval(secs=>seconds),remaining_seconds=seconds where id=r.id returning * into r;
 elsif p_command='pause' and r.status='running' then
  seconds:=greatest(0,ceil(extract(epoch from (r.ends_at-clock_timestamp())))::integer);
  if seconds=0 then raise exception 'Time expired'; end if;
  update public.rooms set status='paused',ends_at=null,remaining_seconds=seconds where id=r.id returning * into r;
 elsif p_command='adjust' then
  if p_seconds is null or p_seconds not in (-600,-300,-60,60,300,600) or r.status not in ('running','paused','ended') then raise exception 'Invalid adjustment'; end if;
  seconds:=case when r.status='running' then greatest(0,ceil(extract(epoch from (r.ends_at-clock_timestamp())))::integer) when r.status='paused' then r.remaining_seconds else 0 end;
  seconds:=greatest(0,least(86400,seconds+p_seconds));
  if r.status='paused' then
   update public.rooms set remaining_seconds=seconds where id=r.id returning * into r;
  elsif seconds>0 then
   update public.rooms set status='running',ends_at=clock_timestamp()+make_interval(secs=>seconds),remaining_seconds=seconds where id=r.id returning * into r;
  else
   update public.rooms set status='ended',ends_at=null,remaining_seconds=0 where id=r.id returning * into r;
  end if;
 elsif p_command='end' then
  update public.rooms set status='ended',ends_at=null,remaining_seconds=0 where id=r.id returning * into r;
 else raise exception 'Invalid transition'; end if;
 return r;
end $$;

create or replace function public.edit_room_missions(p_room_id uuid,p_topics text[])
returns void language plpgsql security invoker set search_path='' as $$
declare r public.rooms; old_m public.room_missions; t public.topics; i integer; n integer:=cardinality(p_topics); v text;
begin
 select * into r from public.rooms where id=p_room_id for update;
 if not found or n is null or n not between 1 and 10 then raise exception 'Invalid room or missions'; end if;
 if exists(select 1 from public.room_missions m join public.submissions s on s.mission_id=m.id where m.room_id=r.id and m.position>n) then raise exception 'Cannot remove missions with submissions'; end if;
 for i in 1..n loop
  v:=p_topics[i]; select * into old_m from public.room_missions where room_id=r.id and position=i;
  if v like 'keep:%' then
   if old_m.id is null or v<>('keep:'||old_m.id::text) then raise exception 'Invalid mission'; end if;
  else
   select * into t from public.topics where id=v::uuid and active;
   if not found then raise exception 'Invalid topic'; end if;
   if old_m.id is null then insert into public.room_missions(room_id,position,title,description) values(r.id,i,t.title,t.description);
   else update public.room_missions set title=t.title,description=t.description where id=old_m.id; end if;
  end if;
 end loop;
 delete from public.room_missions where room_id=r.id and position>n;
end $$;

create table if not exists public.restart_photo_cleanup (room_id uuid not null references public.rooms(id) on delete cascade,photo_path text primary key);
alter table public.restart_photo_cleanup enable row level security;
revoke all on public.restart_photo_cleanup from public,anon,authenticated;
grant all on public.restart_photo_cleanup to service_role;
create or replace function public.restart_room(p_room_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare r public.rooms;
begin
 select * into r from public.rooms where id=p_room_id for update;
 if not found then raise exception 'Room missing'; end if;
 insert into public.restart_photo_cleanup(room_id,photo_path) select room_id,photo_path from public.submissions where room_id=r.id on conflict do nothing;
 update public.rooms set status='ready',ends_at=null,remaining_seconds=1800,generation=generation+1 where id=r.id;
 delete from public.submissions where room_id=r.id;
end $$;
revoke all on function public.restart_room(uuid) from public,anon,authenticated;
grant execute on function public.restart_room(uuid) to service_role;

