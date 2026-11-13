-- Add service-only prefixed API entry points without changing existing objects.
do $facade$
declare n text; p record; def text;
begin
 if (select count(*) from pg_proc pr join pg_namespace ns on ns.oid=pr.pronamespace where ns.nspname='public' and pr.proname=any(array['admin_reset_team_password','change_event_timer','check_team_registration','create_event_room','create_event_room_digits','edit_room_missions','join_team_password','restart_room','verify_admin_login']))<>9 then raise exception 'Unexpected source function inventory'; end if;
 foreach n in array array['admin_credentials','admin_sessions','login_attempts','presets','restart_photo_cleanup','room_missions','rooms','submissions','team_login_attempts','team_sessions','teams','topics'] loop
  if to_regclass('public.'||n) is null then raise exception 'Missing source table %',n; end if;
  execute format('create view public.%I with (security_invoker=true) as select * from public.%I','phototeam_'||n,n);
  execute format('revoke all on public.%I from public,anon,authenticated','phototeam_'||n);
  execute format('grant select,insert,update,delete on public.%I to service_role','phototeam_'||n);
 end loop;
 for p in select pr.oid,pr.proname,pg_get_function_identity_arguments(pr.oid) args from pg_proc pr join pg_namespace ns on ns.oid=pr.pronamespace where ns.nspname='public' and pr.proname=any(array['admin_reset_team_password','check_team_registration','create_event_room','create_event_room_digits','edit_room_missions','join_team_password','restart_room','verify_admin_login']) loop
  def:=pg_get_functiondef(p.oid);
  def:=replace(def,'FUNCTION public.'||p.proname||'(','FUNCTION public.phototeam_'||p.proname||'(');
  execute def;
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated','phototeam_'||p.proname,p.args);
  execute format('grant execute on function public.%I(%s) to service_role','phototeam_'||p.proname,p.args);
 end loop;
end $facade$;

create function public.phototeam_change_event_timer(p_room_id uuid,p_command text,p_seconds integer default null)
returns jsonb language sql security invoker set search_path='' as $$
 select to_jsonb(public.change_event_timer(p_room_id,p_command,p_seconds))
$$;
revoke all on function public.phototeam_change_event_timer(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.phototeam_change_event_timer(uuid,text,integer) to service_role;

create function public.phototeam_save_submission(p_room_id uuid,p_team_id uuid,p_mission_id uuid,p_photo_path text,p_title text,p_description text,p_message text,p_generation integer)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result_id uuid;
begin
 insert into public.submissions(room_id,team_id,mission_id,photo_path,title,description,message,generation)
 values(p_room_id,p_team_id,p_mission_id,p_photo_path,p_title,p_description,p_message,p_generation)
 on conflict(team_id,mission_id) do update set photo_path=excluded.photo_path,title=excluded.title,description=excluded.description,message=excluded.message,generation=excluded.generation
 returning id into result_id;
 return result_id;
end $$;
revoke all on function public.phototeam_save_submission(uuid,uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.phototeam_save_submission(uuid,uuid,uuid,text,text,text,text,integer) to service_role;
notify pgrst, 'reload schema';

