-- Team passwords are stored as bcrypt hashes. Existing passwordless teams
-- can set an initial password only from the original authenticated device.
alter table public.teams add column if not exists password_hash text;
create table if not exists public.team_sessions (
 token_hash text primary key,
 team_id uuid not null references public.teams(id) on delete cascade,
 expires_at timestamptz not null
);
create index if not exists team_sessions_team_id_idx on public.team_sessions(team_id);
create table if not exists public.team_login_attempts (
 room_id uuid not null references public.rooms(id) on delete cascade,
 team_name text not null,
 failures integer not null default 0,
 locked_until timestamptz,
 primary key(room_id,team_name)
);
alter table public.team_sessions enable row level security;
alter table public.team_login_attempts enable row level security;
revoke all on public.team_sessions, public.team_login_attempts from public, anon, authenticated;
grant all on public.team_sessions, public.team_login_attempts to service_role;

create or replace function public.check_team_registration(p_code text, p_name text, p_old_hash text)
returns text language plpgsql security invoker set search_path = '' as $$
declare team_row public.teams%rowtype; room_row public.rooms%rowtype;
begin
 select * into room_row from public.rooms where code=p_code;
 if not found then return 'invalid_room'; end if;
 select * into team_row from public.teams where room_id=room_row.id and name=trim(p_name);
 if not found then return 'new'; end if;
 if team_row.password_hash is not null then return 'existing'; end if;
 if p_old_hash is not null and team_row.token_hash=p_old_hash then return 'legacy_setup'; end if;
 return 'legacy_unavailable';
end;
$$;
revoke all on function public.check_team_registration(text,text,text) from public,anon,authenticated;
grant execute on function public.check_team_registration(text,text,text) to service_role;

create or replace function public.join_team_password(
 p_code text,p_name text,p_password text,p_confirmation text,p_old_hash text,p_new_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare room_row public.rooms%rowtype; team_row public.teams%rowtype; attempts public.team_login_attempts%rowtype; name_clean text;
begin
 name_clean:=trim(p_name);
 if p_code is null or p_name is null or length(name_clean)<1 or length(name_clean)>50
    or p_password is null or length(p_password)<8 or octet_length(p_password)>72
    or p_new_hash is null or p_new_hash !~ '^[0-9a-f]{64}$' then
   return jsonb_build_object('status','invalid');
 end if;
 select * into room_row from public.rooms where code=p_code;
 if not found then return jsonb_build_object('status','invalid_room'); end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(room_row.id::text || ':' || name_clean, 0));
 select * into team_row from public.teams where room_id=room_row.id and name=name_clean for update;
 if not found then
   if room_row.status='ended' or (room_row.status='running' and room_row.ends_at <= clock_timestamp()) then return jsonb_build_object('status','closed'); end if;
   if p_confirmation is distinct from p_password then return jsonb_build_object('status','confirmation'); end if;
   insert into public.teams(room_id,name,token_hash,password_hash)
   values(room_row.id,name_clean,p_new_hash,extensions.crypt(p_password,extensions.gen_salt('bf',10))) returning * into team_row;
 elsif team_row.password_hash is null then
   if p_old_hash is null or p_old_hash<>team_row.token_hash then return jsonb_build_object('status','legacy_unavailable'); end if;
   if p_confirmation is distinct from p_password then return jsonb_build_object('status','confirmation'); end if;
   update public.teams set password_hash=extensions.crypt(p_password,extensions.gen_salt('bf',10)) where id=team_row.id;
 else
   insert into public.team_login_attempts(room_id,team_name) values(room_row.id,name_clean) on conflict do nothing;
   select * into attempts from public.team_login_attempts where room_id=room_row.id and team_name=name_clean for update;
   if attempts.locked_until > clock_timestamp() then return jsonb_build_object('status','locked'); end if;
   if extensions.crypt(p_password,team_row.password_hash)<>team_row.password_hash then
     update public.team_login_attempts set failures=case when locked_until < clock_timestamp() then 1 else failures+1 end,
       locked_until=case when (case when locked_until < clock_timestamp() then 1 else failures+1 end)>=5 then clock_timestamp()+interval '15 minutes' else null end
       where room_id=room_row.id and team_name=name_clean;
     return jsonb_build_object('status','incorrect');
   end if;
   update public.team_login_attempts set failures=0,locked_until=null where room_id=room_row.id and team_name=name_clean;
 end if;
 insert into public.team_sessions(token_hash,team_id,expires_at) values(p_new_hash,team_row.id,clock_timestamp()+interval '30 days');
 return jsonb_build_object('status','ok','id',team_row.id,'room_id',room_row.id,'name',team_row.name);
end;
$$;
revoke all on function public.join_team_password(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.join_team_password(text,text,text,text,text,text) to service_role;

-- New room codes are six digits; older room codes remain valid.
create or replace function public.create_event_room_digits(p_name text, p_date date, p_code text, p_topics uuid[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare new_id uuid;
begin
 if length(trim(p_name))=0 or length(p_name)>100 or p_date is null or p_code !~ '^[0-9]{6}$' or cardinality(p_topics)<>6 then raise exception 'Invalid room data'; end if;
 if (select count(*) from public.topics where id=any(p_topics) and active and category='easy')<>3 or
    (select count(*) from public.topics where id=any(p_topics) and active and category='creative')<>3 then raise exception 'Select three active topics from each category'; end if;
 insert into public.rooms(name,event_date,code) values(trim(p_name),p_date,p_code) returning id into new_id;
 insert into public.room_missions(room_id,position,title,description)
 select new_id,item.ordinality::int,t.title,t.description from unnest(p_topics) with ordinality item(id,ordinality) join public.topics t on t.id=item.id;
 return new_id;
end;
$$;
revoke all on function public.create_event_room_digits(text,date,text,uuid[]) from public,anon,authenticated;
grant execute on function public.create_event_room_digits(text,date,text,uuid[]) to service_role;

