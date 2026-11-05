-- Initial private data model. No client grants: access must go through authenticated server endpoints.
create table if not exists public.rooms (
 id uuid primary key default gen_random_uuid(), name text not null, event_date date,
 code text not null unique, status text not null default 'ready' check (status in ('ready','running','paused','ended')),
 ends_at timestamptz, remaining_seconds integer not null default 1800 check (remaining_seconds >= 0),
 created_at timestamptz not null default now()
);
create table if not exists public.topics (
 id uuid primary key default gen_random_uuid(), category text not null check(category in ('easy','creative')),
 title text not null, description text not null, active boolean not null default true
);
create table if not exists public.room_missions (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms on delete cascade,
 position integer not null check(position between 1 and 6), title text not null, description text not null,
 unique(room_id,position), unique(room_id,id)
);
create table if not exists public.teams (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms on delete cascade,
 name text not null, token_hash text not null, unique(room_id,name), unique(room_id,id)
);
create table if not exists public.submissions (
 id uuid primary key default gen_random_uuid(), room_id uuid not null,
 team_id uuid not null, mission_id uuid not null, photo_path text not null,
 title text not null, description text not null, message text not null, updated_at timestamptz not null default now(),
 foreign key(room_id,team_id) references public.teams(room_id,id) on delete cascade,
 foreign key(room_id,mission_id) references public.room_missions(room_id,id) on delete cascade,
 unique(team_id,mission_id)
);
create table if not exists public.presets (id uuid primary key default gen_random_uuid(), name text not null, missions jsonb not null);
alter table public.rooms enable row level security;
alter table public.topics enable row level security;
alter table public.room_missions enable row level security;
alter table public.teams enable row level security;
alter table public.submissions enable row level security;
alter table public.presets enable row level security;
revoke all on public.rooms, public.topics, public.room_missions, public.teams, public.submissions, public.presets from anon, authenticated;

-- Tables are deliberately private from anonymous and authenticated client roles.
create table if not exists public.admin_credentials (
  id boolean primary key default true check (id), password_hash text not null
);
create table if not exists public.admin_sessions (
  token_hash text primary key, expires_at timestamptz not null
);
create table if not exists public.login_attempts (
  client_hash text primary key, failures integer not null default 0, locked_until timestamptz
);
alter table public.admin_credentials enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.login_attempts enable row level security;
revoke all on public.admin_credentials, public.admin_sessions, public.login_attempts from anon, authenticated;

-- Row lock serializes the deadline check against administrative timer changes.
create schema if not exists private;
create or replace function private.require_open_submission() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare event public.rooms%rowtype;
begin
  select * into event from public.rooms where id = new.room_id for update;
  if not found or event.status <> 'running' or event.ends_at is null or clock_timestamp() >= event.ends_at then
    raise exception 'Submission is closed' using errcode = 'P0001';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.require_open_submission() from public, anon, authenticated;
-- This function is callable only with the service role. It serializes login
-- attempts so simultaneous incorrect requests cannot bypass the lockout.
create or replace function public.verify_admin_login(p_password text, p_token_hash text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare attempts public.login_attempts%rowtype; stored_hash text;
begin
  if length(p_password) < 1 or length(p_password) > 256 or p_token_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  insert into public.login_attempts(client_hash) values ('global') on conflict do nothing;
  select * into attempts from public.login_attempts where client_hash='global' for update;
  if attempts.locked_until > clock_timestamp() then return false; end if;
  select password_hash into stored_hash from public.admin_credentials where id=true;
  if stored_hash is null or extensions.crypt(p_password, stored_hash) <> stored_hash then
    update public.login_attempts set failures=case when locked_until < clock_timestamp() then 1 else failures+1 end,
      locked_until=case when (case when locked_until < clock_timestamp() then 1 else failures+1 end) >= 5 then clock_timestamp()+interval '15 minutes' else null end where client_hash='global';
    return false;
  end if;
  update public.login_attempts set failures=0, locked_until=null where client_hash='global';
  insert into public.admin_sessions(token_hash,expires_at) values(p_token_hash,clock_timestamp()+interval '8 hours');
  return true;
end;
$$;
revoke all on function public.verify_admin_login(text,text) from public, anon, authenticated;
grant execute on function public.verify_admin_login(text,text) to service_role;
-- All-or-nothing room creation; copied mission text is not affected by later edits.
create or replace function public.create_event_room(p_name text, p_date date, p_code text, p_topics uuid[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare new_id uuid;
begin
 if length(trim(p_name))=0 or length(p_name)>100 or p_date is null or p_code !~ '^[A-Z0-9]{6}$' or cardinality(p_topics)<>6 then
  raise exception 'Invalid room data';
 end if;
 if (select count(*) from public.topics where id=any(p_topics) and active and category='easy')<>3 or
    (select count(*) from public.topics where id=any(p_topics) and active and category='creative')<>3 then
  raise exception 'Select three active topics from each category';
 end if;
 insert into public.rooms(name,event_date,code) values(trim(p_name),p_date,p_code) returning id into new_id;
 insert into public.room_missions(room_id,position,title,description)
 select new_id, item.ordinality::int,t.title,t.description
 from unnest(p_topics) with ordinality item(id,ordinality) join public.topics t on t.id=item.id;
 return new_id;
end;
$$;
revoke all on function public.create_event_room(text,date,text,uuid[]) from public,anon,authenticated;
grant execute on function public.create_event_room(text,date,text,uuid[]) to service_role;
create or replace function public.change_event_timer(p_room_id uuid,p_command text,p_seconds integer default null)
returns public.rooms language plpgsql security invoker set search_path = '' as $$
declare r public.rooms%rowtype; seconds integer;
begin
 select * into r from public.rooms where id=p_room_id for update;
 if not found or r.status='ended' or (r.status='running' and clock_timestamp()>=r.ends_at) then raise exception 'Event ended'; end if;
 if p_command='start' then
  seconds := case when r.status='paused' then r.remaining_seconds else p_seconds end;
  if seconds is null or seconds < 1 or seconds > 86400 then raise exception 'Invalid duration'; end if;
  update public.rooms set status='running',ends_at=clock_timestamp()+make_interval(secs=>seconds),remaining_seconds=seconds where id=r.id returning * into r;
 elsif p_command='pause' and r.status='running' then
  seconds:=greatest(0,ceil(extract(epoch from (r.ends_at-clock_timestamp())))::integer);
  if seconds=0 then raise exception 'Event ended'; end if;
  update public.rooms set status='paused',ends_at=null,remaining_seconds=seconds where id=r.id returning * into r;
 elsif p_command='end' then
  update public.rooms set status='ended',ends_at=null,remaining_seconds=0 where id=r.id returning * into r;
 else raise exception 'Invalid transition'; end if;
 return r;
end;
$$;
revoke all on function public.change_event_timer(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.change_event_timer(uuid,text,integer) to service_role;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='enforce_submission_deadline' AND tgrelid='public.submissions'::regclass AND NOT tgisinternal) THEN CREATE TRIGGER enforce_submission_deadline BEFORE INSERT OR UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION private.require_open_submission(); END IF; END $$;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('mission-photos','mission-photos',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif']) on conflict(id) do nothing;

