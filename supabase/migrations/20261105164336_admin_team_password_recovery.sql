-- Administrator-assisted recovery for teams created before passwords or whose
-- members cannot authenticate. Existing sessions are revoked on reset.
create or replace function public.admin_reset_team_password(p_room_id uuid,p_team_id uuid,p_password text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare team_row public.teams%rowtype;
begin
 if p_password is null or length(p_password)<8 or octet_length(p_password)>72 then return false; end if;
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

