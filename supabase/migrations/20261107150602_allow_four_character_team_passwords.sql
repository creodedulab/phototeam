create or replace function public.join_team_password(
 p_code text,p_name text,p_password text,p_confirmation text,p_old_hash text,p_new_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare room_row public.rooms%rowtype; team_row public.teams%rowtype; attempts public.team_login_attempts%rowtype; name_clean text;
begin
 name_clean:=trim(p_name);
 if p_code is null or p_name is null or length(name_clean)<1 or length(name_clean)>50
    or p_password is null or length(p_password)<4 or octet_length(p_password)>72
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

-- Administrator-assisted recovery for teams created before passwords or whose
-- members cannot authenticate. Existing sessions are revoked on reset.
create or replace function public.admin_reset_team_password(p_room_id uuid,p_team_id uuid,p_password text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare team_row public.teams%rowtype;
begin
 if p_password is null or length(p_password)<4 or octet_length(p_password)>72 then return false; end if;
 select * into team_row from public.teams where id=p_team_id and room_id=p_room_id for update;
 if not found then return false; end if;
 update public.teams set password_hash=extensions.crypt(p_password,extensions.gen_salt('bf',10)) where id=team_row.id;
 delete from public.team_sessions where team_id=team_row.id;
 delete from public.team_login_attempts where room_id=team_row.room_id and team_name=team_row.name;
 return true;
end;
$$;
revoke all on function public.admin_reset_team_password(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_reset_team_password(uuid,uuid,text) to service_role;

