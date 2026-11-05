import { hashToken, isEnded, isOpen, randomToken, reply, cors } from './security.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const url = Deno.env.get('SUPABASE_URL')!;
const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const secret = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !secret) throw new Error('Server configuration missing');
const db = createClient(url, secret, { auth: { persistSession: false } });
const bucket = db.storage.from('mission-photos');
const clean = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const assertOk = (error: unknown) => { if (error) throw error; };

async function admin(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const { data, error } = await db.from('admin_sessions').select('expires_at').eq('token_hash', await hashToken(token)).maybeSingle();
  if (error) throw error;
  return !!data && Date.parse(data.expires_at) > Date.now();
}
async function team(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const hash = await hashToken(token);
  const session = await db.from('team_sessions').select('team_id,expires_at').eq('token_hash',hash).maybeSingle();
  if (session.error) throw session.error;
  if (session.data && Date.parse(session.data.expires_at) > Date.now()) {
    const result = await db.from('teams').select('id,room_id,name').eq('id',session.data.team_id).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }
  // Tokens issued before team passwords existed continue to work on the original device.
  const legacy = await db.from('teams').select('id,room_id,name').eq('token_hash',hash).is('password_hash',null).maybeSingle();
  if (legacy.error) throw legacy.error;
  return legacy.data;
}
async function loadRoom(id: string) {
  const { data, error } = await db.from('rooms').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}
async function signed(path: string) {
  const { data, error } = await bucket.createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
async function removePrefix(prefix: string): Promise<void> {
  const files: string[] = [];
  async function visit(path: string) {
    let offset = 0;
    for (;;) {
      const { data, error } = await bucket.list(path, { limit: 100, offset });
      if (error) throw error;
      for (const item of data || []) {
        const full = path + '/' + item.name;
        if (item.id) files.push(full); else await visit(full);
      }
      if (!data || data.length < 100) break;
      offset += data.length;
    }
  }
  await visit(prefix);
  for (let i=0; i<files.length; i+=100) { const {error} = await bucket.remove(files.slice(i,i+100)); if(error) throw error; }
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json();
    const action = clean(body.action, 40);
    const token = clean(body.token, 64);
    if (action === 'login') {
      const password = clean(body.password, 256);
      if (!password) return reply({ error: '비밀번호를 입력해 주세요.' }, 400);
      const newToken = randomToken();
      const result = await db.rpc('verify_admin_login', { p_password: password, p_token_hash: await hashToken(newToken) });
      assertOk(result.error);
      if (!result.data) return reply({ error: '비밀번호를 확인해 주세요. 실패가 반복되면 잠시 후 다시 시도해 주세요.' }, 401);
      return reply({ token: newToken });
    }
    if (action === 'team_check') {
      const code=clean(body.code,20).toUpperCase(), name=clean(body.name,50);
      if (!code || !name) return reply({ error: '입장 코드와 팀 이름을 입력해 주세요.' },400);
      const oldHash=/^[0-9a-f]{64}$/.test(token) ? await hashToken(token) : null;
      const result=await db.rpc('check_team_registration',{p_code:code,p_name:name,p_old_hash:oldHash});
      assertOk(result.error);
      if (result.data === 'invalid_room') return reply({error:'입장 코드를 확인해 주세요.'},404);
      return reply({status:result.data});
    }
    if (action === 'join') {
      const code=clean(body.code,20).toUpperCase(), name=clean(body.name,50);
      const password=typeof body.password === 'string' ? body.password : '';
      const confirmation=typeof body.confirmation === 'string' ? body.confirmation : null;
      if (!code || !name || Array.from(password).length<8 || new TextEncoder().encode(password).length>72) return reply({error:'입장 코드, 팀 이름, 8자 이상 비밀번호를 확인해 주세요.'},400);
      const newToken=randomToken(), oldHash=/^[0-9a-f]{64}$/.test(token) ? await hashToken(token) : null;
      const result=await db.rpc('join_team_password',{p_code:code,p_name:name,p_password:password,p_confirmation:confirmation,p_old_hash:oldHash,p_new_hash:await hashToken(newToken)});
      assertOk(result.error);
      const value=result.data;
      if (value?.status !== 'ok') {
        const messages={invalid_room:'입장 코드를 확인해 주세요.',invalid:'팀 이름과 비밀번호를 확인해 주세요.',confirmation:'비밀번호 확인이 일치하지 않습니다.',closed:'종료된 방입니다.',legacy_unavailable:'기존 팀은 원래 기기에서 비밀번호를 등록하거나 관리자에게 재설정을 요청해 주세요.',locked:'비밀번호 입력이 여러 번 틀려 15분간 잠겼습니다.',incorrect:'팀 비밀번호가 일치하지 않습니다.'};
        return reply({error:messages[value?.status] || '입장 정보를 확인해 주세요.',status:value?.status}, value?.status==='invalid_room'?404:400);
      }
      return reply({token:newToken,team:{id:value.id,room_id:value.room_id,name:value.name}});
    }
    if (action === 'team_state') {
      const t = await team(token);
      if (!t) return reply({ error: '다시 입장해 주세요.' }, 401);
      const room = await loadRoom(t.room_id);
      const [missions, submissions] = await Promise.all([
        db.from('room_missions').select('id,position,title,description').eq('room_id', room.id).order('position'),
        db.from('submissions').select('id,mission_id,photo_path,title,description,message,updated_at').eq('team_id', t.id),
      ]);
      assertOk(missions.error); assertOk(submissions.error);
      const items = await Promise.all((submissions.data || []).map(async x => ({ ...x, photo_url: body.light === true ? undefined : await signed(x.photo_path), photo_path: undefined })));
      return reply({ team: t, room: { id: room.id, name: room.name, status: room.status, ends_at: room.ends_at, remaining_seconds: room.remaining_seconds }, missions: missions.data, submissions: items, server_time: new Date().toISOString() });
    }
    if (action === 'submit') {
      const t = await team(token); if (!t) return reply({ error: '다시 입장해 주세요.' }, 401);
      const room = await loadRoom(t.room_id); if (!isOpen(room)) return reply({ error: '제출 시간이 종료되었거나 일시정지되었습니다.' }, 403);
      const missionId = clean(body.mission_id, 36), title = clean(body.title, 200), description = clean(body.description, 2000), message = clean(body.message, 500);
      const photo = clean(body.photo, 4500000);
      if (!title || !description || !message || (photo && !/^data:image\/jpeg;base64,/.test(photo))) return reply({ error: '사진과 모든 내용을 입력해 주세요.' }, 400);
      const mission = await db.from('room_missions').select('id').eq('room_id', room.id).eq('id', missionId).maybeSingle();
      assertOk(mission.error); if (!mission.data) return reply({ error: '미션을 찾을 수 없습니다.' }, 404);
      const old = await db.from('submissions').select('photo_path').eq('team_id', t.id).eq('mission_id', missionId).maybeSingle(); assertOk(old.error);
      if (!photo) {
        if (!old.data?.photo_path) return reply({ error: '사진을 선택해 주세요.' }, 400);
        const updated = await db.from('submissions').update({title,description,message}).eq('team_id',t.id).eq('mission_id',missionId);
        if (updated.error) return reply({ error: '시간이 종료되어 저장할 수 없습니다.' }, 409);
        return reply({ok:true});
      }
      let bytes: Uint8Array; try { bytes = Uint8Array.from(atob(photo.split(',')[1]), c => c.charCodeAt(0)); } catch { return reply({ error: '사진을 읽을 수 없습니다.' }, 400); }
      if (bytes.length > 3_000_000 || bytes.length < 3 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) return reply({ error: '사진 파일이 올바르지 않습니다.' }, 400);
      const path = `${room.id}/${t.id}/${missionId}/${crypto.randomUUID()}.jpg`;
      const up = await bucket.upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '0' }); assertOk(up.error);
      const saved = await db.from('submissions').upsert({ room_id: room.id, team_id: t.id, mission_id: missionId, photo_path: path, title, description, message }, { onConflict: 'team_id,mission_id' });
      if (saved.error) { await bucket.remove([path]); return reply({ error: '저장하지 못했습니다. 시간이 종료되었는지 확인해 주세요.' }, 409); }
      if (old.data?.photo_path) await bucket.remove([old.data.photo_path]);
      return reply({ ok: true });
    }
    if (action.startsWith('admin_') && !(await admin(token))) return reply({ error: '관리자 로그인이 필요합니다.' }, 401);
    if (action === 'admin_logout') {
      const result = await db.from('admin_sessions').delete().eq('token_hash', await hashToken(token));
      assertOk(result.error); return reply({ok:true});
    }
    if (action === 'admin_rooms') {
      const result = await db.from('rooms').select('id,name,event_date,code,status,ends_at,remaining_seconds,created_at').order('created_at', { ascending: false });
      assertOk(result.error); return reply({ rooms: result.data, server_time: new Date().toISOString() });
    }
    if (action === 'admin_room') {
      const room = await loadRoom(clean(body.room_id, 36));
      const reveal = isEnded(room) && body.light !== true;
      const [missions, teams, submissions] = await Promise.all([
        db.from('room_missions').select('id,position,title,description').eq('room_id', room.id).order('position'),
        db.from('teams').select('id,name').eq('room_id', room.id).order('name'),
        db.from('submissions').select(reveal ? 'id,team_id,mission_id,photo_path,title,description,message' : 'id,team_id,mission_id').eq('room_id', room.id),
      ]);
      assertOk(missions.error); assertOk(teams.error); assertOk(submissions.error);
      const rows = reveal ? await Promise.all((submissions.data || []).map(async (x: any) => ({ ...x, photo_url: await signed(x.photo_path), photo_path: undefined }))) : submissions.data;
      return reply({ room, missions: missions.data, teams: teams.data, submissions: rows, server_time: new Date().toISOString() });
    }
    if (action === 'admin_timer') {
      const result = await db.rpc('change_event_timer', { p_room_id: clean(body.room_id,36), p_command: clean(body.command,10), p_seconds: body.seconds == null ? null : Number(body.seconds) });
      if (result.error) return reply({ error: '시간이나 행사 상태를 확인해 주세요.' }, 409);
      return reply({ room: result.data, server_time: new Date().toISOString() });
    }
    if (action === 'admin_topics') {
      const result = await db.from('topics').select('*').order('title'); assertOk(result.error); return reply({ topics: result.data });
    }
    if (action === 'admin_create_room') {
      const name = clean(body.name, 100), date = clean(body.date, 10);
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(body.topics) || body.topics.length !== 6) return reply({ error: '방 이름, 날짜, 미션을 확인해 주세요.' }, 400);
      for (let n = 0; n < 10; n++) {
        let random; do { random = crypto.getRandomValues(new Uint32Array(1))[0]; } while (random >= 4294000000);
        const code = String(random % 1000000).padStart(6, '0');
        const result = await db.rpc('create_event_room_digits', { p_name: name, p_date: date, p_code: code, p_topics: body.topics });
        if (!result.error) return reply({ id: result.data, code });
        if (result.error.code !== '23505') return reply({ error: '선택한 미션을 확인해 주세요.' }, 400);
      }
      return reply({ error: '방 코드를 만들지 못했습니다. 다시 시도해 주세요.' }, 500);
    }
    if (action === 'admin_save_topic') {
      const title = clean(body.title, 100), description = clean(body.description, 500), category = clean(body.category, 10);
      if (!title || !description || !['easy','creative'].includes(category)) return reply({ error: '주제와 설명을 확인해 주세요.' }, 400);
      const item = { title, description, category, active: body.active !== false };
      const result = body.id ? await db.from('topics').update(item).eq('id', clean(body.id, 36)).select().single() : await db.from('topics').insert(item).select().single();
      assertOk(result.error); return reply({ topic: result.data });
    }
    if (action === 'admin_presets') {
      const result = await db.from('presets').select('*').order('name'); assertOk(result.error); return reply({ presets: result.data });
    }
    if (action === 'admin_save_preset') {
      const name = clean(body.name, 100), missions = body.missions;
      if (!name || !Array.isArray(missions) || missions.length !== 6 || new Set(missions).size !== 6) return reply({ error: '조합을 확인해 주세요.' }, 400);
      const found = await db.from('topics').select('id,category,active').in('id', missions); assertOk(found.error);
      if (found.data?.filter(x => x.active && x.category === 'easy').length !== 3 || found.data?.filter(x => x.active && x.category === 'creative').length !== 3) return reply({ error: '각 유형에서 주제 3개를 선택해 주세요.' }, 400);
      const result = body.id ? await db.from('presets').update({ name, missions }).eq('id', clean(body.id, 36)).select().single() : await db.from('presets').insert({ name, missions }).select().single();
      assertOk(result.error); return reply({ preset: result.data });
    }
    if (action === 'admin_delete_preset') {
      const result = await db.from('presets').delete().eq('id', clean(body.id, 36)); assertOk(result.error); return reply({ ok: true });
    }
    if (action === 'admin_reset_team_password') {
      const password=typeof body.password==='string'?body.password:'';
      if (Array.from(password).length<8 || new TextEncoder().encode(password).length>72) return reply({error:'비밀번호는 8자 이상 72바이트 이하로 입력해 주세요.'},400);
      const result=await db.rpc('admin_reset_team_password',{p_room_id:clean(body.room_id,36),p_team_id:clean(body.team_id,36),p_password:password});
      assertOk(result.error); if (!result.data) return reply({error:'팀을 찾을 수 없습니다.'},404);
      return reply({ok:true});
    }
    if (action === 'admin_delete') {
      const room = await loadRoom(clean(body.room_id, 36));
      const target = clean(body.target, 15), id = clean(body.id, 36);
      if (!['room','team','submission'].includes(target)) return reply({ error: '삭제 대상을 확인해 주세요.' }, 400);
      if (target === 'submission') {
        const found=await db.from('submissions').select('id,photo_path').eq('room_id',room.id).eq('id',id).maybeSingle();
        assertOk(found.error); if (!found.data) return reply({error:'제출물을 찾을 수 없습니다.'},404);
        const deleted=await db.from('submissions').delete().eq('room_id',room.id).eq('id',id).eq('photo_path',found.data.photo_path).select('id').maybeSingle();
        assertOk(deleted.error); if (!deleted.data) return reply({error:'제출물이 변경되었습니다. 다시 확인해 주세요.'},409);
        const removed=await bucket.remove([found.data.photo_path]);
        if (removed.error) { console.error('Photo cleanup failed'); return reply({error:'제출물은 삭제되었으나 사진 파일 정리에 실패했습니다. 관리자에게 문의해 주세요.'},500); }
        return reply({ok:true});
      }
      const table=target==='room'?'rooms':'teams';
      let query=db.from(table).delete().eq('id',target==='room'?room.id:id);
      if (target==='team') query=query.eq('room_id',room.id);
      const deleted=await query.select('id').maybeSingle();
      assertOk(deleted.error); if (!deleted.data) return reply({error:'대상을 찾을 수 없습니다.'},404);
      try { await removePrefix(target==='room'?room.id:room.id+'/'+id); }
      catch { console.error('Photo cleanup failed'); return reply({error:'방 또는 팀은 삭제되었으나 사진 파일 정리에 실패했습니다. 관리자에게 문의해 주세요.'},500); }
      return reply({ok:true});
    }
    return reply({ error: '지원하지 않는 요청입니다.' }, 404);
  } catch (error) {
    console.error('phototeam API error', error instanceof Error ? error.message : 'database operation failed');
    return reply({ error: '요청을 처리하지 못했습니다. 다시 시도해 주세요.' }, 500);
  }
});


