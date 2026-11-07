-- Preserve old room missions and submissions; serialize edits and submissions on the room row.
alter table public.room_missions drop constraint room_missions_position_check;
alter table public.room_missions add constraint room_missions_position_check check (position between 1 and 10);

create or replace function public.create_event_room_digits(p_name text,p_date date,p_code text,p_topics uuid[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare new_id uuid; n integer:=cardinality(p_topics);
begin
 if length(trim(p_name))=0 or length(p_name)>100 or p_date is null or p_code !~ '^[0-9]{6}$' or n is null or n not between 1 and 10 then raise exception 'Invalid room data'; end if;
 if (select count(*) from public.topics where id=any(p_topics) and active)<>n then raise exception 'Invalid or duplicated topics'; end if;
 insert into public.rooms(name,event_date,code) values(trim(p_name),p_date,p_code) returning id into new_id;
 insert into public.room_missions(room_id,position,title,description)
 select new_id,item.ordinality::integer,t.title,t.description from unnest(p_topics) with ordinality item(id,ordinality) join public.topics t on t.id=item.id;
 return new_id;
end $$;

create or replace function public.change_event_timer(p_room_id uuid,p_command text,p_seconds integer default null)
returns public.rooms language plpgsql security invoker set search_path='' as $$
declare r public.rooms; seconds integer;
begin
 select * into r from public.rooms where id=p_room_id for update;
 if not found or r.status='ended' then raise exception 'Mission ended'; end if;
 if p_command='start' then
  seconds:=p_seconds;
  if seconds is null or seconds<1 or seconds>86400 then raise exception 'Invalid duration'; end if;
  update public.rooms set status='running',ends_at=clock_timestamp()+make_interval(secs=>seconds),remaining_seconds=seconds where id=r.id returning * into r;
 elsif p_command='adjust' then
  if p_seconds is null or p_seconds not in (-600,-300,-60,60,300,600) or r.status<>'running' then raise exception 'Invalid adjustment'; end if;
  seconds:=greatest(0,ceil(extract(epoch from (r.ends_at-clock_timestamp())))::integer);
  seconds:=greatest(0,least(86400,seconds+p_seconds));
  update public.rooms set ends_at=clock_timestamp()+make_interval(secs=>seconds),remaining_seconds=seconds where id=r.id returning * into r;
 elsif p_command='pause' and r.status='running' then
  seconds:=greatest(0,ceil(extract(epoch from (r.ends_at-clock_timestamp())))::integer);
  update public.rooms set status='paused',ends_at=null,remaining_seconds=seconds where id=r.id returning * into r;
 elsif p_command='end' then
  update public.rooms set status='ended',ends_at=null,remaining_seconds=0 where id=r.id returning * into r;
 else raise exception 'Invalid transition'; end if;
 return r;
end $$;

-- Slots either preserve their current mission or point to a new active catalog topic.
create or replace function public.edit_room_missions(p_room_id uuid,p_topics text[])
returns void language plpgsql security invoker set search_path='' as $$
declare r public.rooms; old_m public.room_missions; t public.topics; i integer; n integer:=cardinality(p_topics); v text;
begin
 select * into r from public.rooms where id=p_room_id for update;
 if not found or r.status='ended' then raise exception 'Cannot edit ended room'; end if;
 if n is null or n not between 1 and 10 then raise exception 'Select one to ten missions'; end if;
 for old_m in select * from public.room_missions where room_id=r.id order by position loop
  if old_m.position>n or p_topics[old_m.position]<>('keep:'||old_m.id::text) then
   if exists(select 1 from public.submissions where room_id=r.id and mission_id=old_m.id) then raise exception 'Mission has submissions'; end if;
  end if;
 end loop;
 for i in 1..n loop
  v:=p_topics[i]; select * into old_m from public.room_missions where room_id=r.id and position=i;
  if v like 'keep:%' then
   if old_m.id is null or v<>('keep:'||old_m.id::text) then raise exception 'Invalid mission'; end if;
  else
   select * into t from public.topics where id=v::uuid and active;
   if not found then raise exception 'Invalid topic'; end if;
   if old_m.id is not null then delete from public.room_missions where id=old_m.id; end if;
   insert into public.room_missions(room_id,position,title,description) values(r.id,i,t.title,t.description);
  end if;
 end loop;
 delete from public.room_missions where room_id=r.id and position>n;
end $$;
revoke all on function public.edit_room_missions(uuid,text[]) from public,anon,authenticated;
grant execute on function public.edit_room_missions(uuid,text[]) to service_role;

