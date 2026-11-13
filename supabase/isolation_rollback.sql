-- Recovery only: retain the service-only API facade and move the original objects back.
do $rollback$
declare n text; p record; def text;
begin
 foreach n in array array['admin_credentials','admin_sessions','login_attempts','presets','restart_photo_cleanup','room_missions','rooms','submissions','team_login_attempts','team_sessions','teams','topics'] loop
  if to_regclass('public.'||n) is not null or to_regclass('phototeam.'||n) is null then raise exception 'Rollback name conflict or source missing: %',n; end if;
 end loop;
 for p in select pr.oid,pr.proname,pg_get_function_identity_arguments(pr.oid) args from pg_proc pr join pg_namespace ns on ns.oid=pr.pronamespace where ns.nspname='phototeam' and pr.proname=any(array['admin_reset_team_password','change_event_timer','check_team_registration','create_event_room','create_event_room_digits','edit_room_missions','join_team_password','restart_room','verify_admin_login']) loop
  if exists(select 1 from pg_proc x join pg_namespace y on y.oid=x.pronamespace where y.nspname='public' and x.proname=p.proname and x.proargtypes=(select z.proargtypes from pg_proc z where z.oid=p.oid)) then raise exception 'Rollback function conflict: %',p.proname; end if;
 end loop;
 foreach n in array array['admin_credentials','admin_sessions','login_attempts','presets','restart_photo_cleanup','room_missions','rooms','submissions','team_login_attempts','team_sessions','teams','topics'] loop execute format('alter table phototeam.%I set schema public',n); end loop;
 for p in select pr.oid,pr.proname,pg_get_function_identity_arguments(pr.oid) args from pg_proc pr join pg_namespace ns on ns.oid=pr.pronamespace where ns.nspname='phototeam' and pr.proname=any(array['admin_reset_team_password','change_event_timer','check_team_registration','create_event_room','create_event_room_digits','edit_room_missions','join_team_password','restart_room','verify_admin_login']) loop
  execute format('alter function phototeam.%I(%s) set schema public',p.proname,p.args);def:=replace(pg_get_functiondef(p.oid),'phototeam.','public.');execute def;
 end loop;
 alter function phototeam.require_open_submission() set schema private;
 def:=replace(pg_get_functiondef('private.require_open_submission()'::regprocedure),'phototeam.','public.');execute def;
 for p in select pr.oid from pg_proc pr join pg_namespace ns on ns.oid=pr.pronamespace where ns.nspname='public' and pr.proname=any(array['phototeam_admin_reset_team_password','phototeam_change_event_timer','phototeam_check_team_registration','phototeam_create_event_room','phototeam_create_event_room_digits','phototeam_edit_room_missions','phototeam_join_team_password','phototeam_restart_room','phototeam_verify_admin_login','phototeam_save_submission']) loop
  def:=replace(pg_get_functiondef(p.oid),'phototeam.','public.');execute def;
 end loop;
end $rollback$;
notify pgrst, 'reload schema';

