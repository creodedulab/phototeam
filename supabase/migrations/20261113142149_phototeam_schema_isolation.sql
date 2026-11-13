-- Move existing objects in-place: PostgreSQL preserves row, table and FK identities.
create schema phototeam;
revoke all on schema phototeam from public,anon,authenticated;
grant usage on schema phototeam to service_role;
alter default privileges for role postgres in schema phototeam revoke all on tables from public,anon,authenticated;
alter default privileges for role postgres in schema phototeam revoke execute on functions from public,anon,authenticated;
do $move$
declare n text; p record; def text;
begin
 if (select count(*) from pg_proc pr join pg_namespace ns on ns.oid=pr.pronamespace where ns.nspname='public' and pr.proname=any(array['admin_reset_team_password','change_event_timer','check_team_registration','create_event_room','create_event_room_digits','edit_room_missions','join_team_password','restart_room','verify_admin_login']))<>9 then raise exception 'Unexpected source function inventory'; end if;
 if (select count(*) from pg_proc pr join pg_namespace ns on ns.oid=pr.pronamespace where ns.nspname='public' and pr.proname=any(array['phototeam_admin_reset_team_password','phototeam_change_event_timer','phototeam_check_team_registration','phototeam_create_event_room','phototeam_create_event_room_digits','phototeam_edit_room_missions','phototeam_join_team_password','phototeam_restart_room','phototeam_verify_admin_login','phototeam_save_submission']))<>10 then raise exception 'Unexpected facade function inventory'; end if;
 foreach n in array array['admin_credentials','admin_sessions','login_attempts','presets','restart_photo_cleanup','room_missions','rooms','submissions','team_login_attempts','team_sessions','teams','topics'] loop
  if to_regclass('public.'||n) is null or to_regclass('public.phototeam_'||n) is null then raise exception 'Missing source or facade %',n; end if;
  execute format('alter table public.%I set schema phototeam',n);
 end loop;
 for p in select pr.oid,pr.proname,pg_get_function_identity_arguments(pr.oid) args from pg_proc pr join pg_namespace ns on ns.oid=pr.pronamespace where ns.nspname='public' and pr.proname=any(array['admin_reset_team_password','change_event_timer','check_team_registration','create_event_room','create_event_room_digits','edit_room_missions','join_team_password','restart_room','verify_admin_login']) loop
  execute format('alter function public.%I(%s) set schema phototeam',p.proname,p.args);
  def:=replace(pg_get_functiondef(p.oid),'public.','phototeam.');
  execute def;
 end loop;
 alter function private.require_open_submission() set schema phototeam;
 def:=replace(pg_get_functiondef('phototeam.require_open_submission()'::regprocedure),'public.','phototeam.');
 execute def;
 for p in select pr.oid,pr.proname from pg_proc pr join pg_namespace ns on ns.oid=pr.pronamespace where ns.nspname='public' and pr.proname=any(array['phototeam_admin_reset_team_password','phototeam_change_event_timer','phototeam_check_team_registration','phototeam_create_event_room','phototeam_create_event_room_digits','phototeam_edit_room_missions','phototeam_join_team_password','phototeam_restart_room','phototeam_verify_admin_login','phototeam_save_submission']) loop
  def:=replace(pg_get_functiondef(p.oid),'public.','phototeam.');
  def:=replace(def,'FUNCTION phototeam.'||p.proname||'(','FUNCTION public.'||p.proname||'(');
  execute def;
 end loop;
end $move$;
notify pgrst, 'reload schema';

