import { hashToken, isEnded, isOpen, randomToken, reply, cors } from './security.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.10';

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
  const { data, error } = await db.from('teams').select('id,room_id,name').eq('token_hash', await hashToken(token)).maybeSingle();
  if (error) throw error;
  return data;
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
    if (action === 'join') {
      const code = clean(body.code, 20).toUpperCase();
      const name = clean(body.name, 50);
      const { data: room, error } = await db.from('rooms').select('id,status,ends_at').eq('code', code).maybeSingle();
      assertOk(error);
      if (!room) return reply({ error: '입장 코드를 확인해 주세요.' }, 404);
      const existing = await team(token);
      if (existing && existing.room_id === room.id) return reply({ token, team: existing });
      if (!name) return reply({ error: '팀 이름을 입력해 주세요.' }, 400);
      if (isEnded(room)) return reply({ error: '종료된 방입니다.' }, 403);
      const newToken = randomToken();
      const result = await db.from('teams').insert({ room_id: room.id, name, token_hash: await hashToken(newToken) }).select('id,room_id,name').single();
      if (result.error?.code === '23505') return reply({ error: '이미 사용 중인 팀 이름입니다. 다른 이름을 입력해 주세요.' }, 409);
      assertOk(result.error);
      return reply({ token: newToken, team: result.data });
    }
    if (action === 'team_state') {
      const t = await team(token);
      if (!t) return reply({ error: '다시 입장해 주세요.' }, 401);
      const room = await loadRoom(t.room_id);
      const [missions, submissions] = await Promise.all([
        db.from('room_missions').select('id,position,title,description').eq('room_id', room.id).order('position'),
        db.from('submissions').select('id,mission_id,photo_path,title,description,message').eq('team_id', t.id),
      ]);
      assertOk(missions.error); assertOk(submissions.error);
      const items = await Promise.all((submissions.data || []).map(async x => ({ ...x, photo_url: await signed(x.photo_path), photo_path: undefined })));
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
    if (action === 'admin_rooms') {
      const result = await db.from('rooms').select('id,name,event_date,code,status,ends_at,remaining_seconds,created_at').order('created_at', { ascending: false });
      assertOk(result.error); return reply({ rooms: result.data, server_time: new Date().toISOString() });
    }
    if (action === 'admin_room') {
      const room = await loadRoom(clean(body.room_id, 36));
      const [missions, teams, submissions] = await Promise.all([
        db.from('room_missions').select('id,position,title,description').eq('room_id', room.id).order('position'),
        db.from('teams').select('id,name').eq('room_id', room.id).order('name'),
        db.from('submissions').select(isEnded(room) ? 'id,team_id,mission_id,photo_path,title,description,message' : 'id,team_id,mission_id').eq('room_id', room.id),
      ]);
      assertOk(missions.error); assertOk(teams.error); assertOk(submissions.error);
      const rows = isEnded(room) ? await Promise.all((submissions.data || []).map(async (x: any) => ({ ...x, photo_url: await signed(x.photo_path), photo_path: undefined }))) : submissions.data;
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
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for (let n = 0; n < 5; n++) {
        const bytes = crypto.getRandomValues(new Uint8Array(6));
        const code = Array.from(bytes, x => alphabet[x % alphabet.length]).join('');
        const result = await db.rpc('create_event_room', { p_name: name, p_date: date, p_code: code, p_topics: body.topics });
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
    if (action === 'admin_delete') {
      const room = await loadRoom(clean(body.room_id, 36));
      const target = clean(body.target, 15), id = clean(body.id, 36);
      if (!['room','team','submission'].includes(target)) return reply({ error: '삭제 대상을 확인해 주세요.' }, 400);
      if (target !== 'room' && !isEnded(room)) return reply({ error: '행사 종료 후 삭제할 수 있습니다.' }, 403);
      if (target === 'room') await removePrefix(room.id);
      if (target === 'team') {
        const found = await db.from('teams').select('id').eq('room_id', room.id).eq('id', id).maybeSingle();
        assertOk(found.error); if (!found.data) return reply({ error: '팀을 찾을 수 없습니다.' }, 404);
        await removePrefix(room.id + '/' + id);
      }
      if (target === 'submission') {
        const found = await db.from('submissions').select('team_id,mission_id').eq('room_id', room.id).eq('id', id).maybeSingle();
        assertOk(found.error); if (!found.data) return reply({ error: '제출물을 찾을 수 없습니다.' }, 404);
        await removePrefix(room.id + '/' + found.data.team_id + '/' + found.data.mission_id);
      }
      let result;
      if (target === 'room') result = await db.from('rooms').delete().eq('id', room.id);
      else if (target === 'team') result = await db.from('teams').delete().eq('room_id', room.id).eq('id', id);
      else result = await db.from('submissions').delete().eq('room_id', room.id).eq('id', id);
      assertOk(result.error); return reply({ ok: true });
    }
    return reply({ error: '지원하지 않는 요청입니다.' }, 404);
  } catch (error) {
    console.error('phototeam API error', error instanceof Error ? error.message : 'database operation failed');
    return reply({ error: '요청을 처리하지 못했습니다. 다시 시도해 주세요.' }, 500);
  }
});

