import assert from 'node:assert/strict';import fs from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import * as security from '../supabase/functions/phototeam/security.ts';
let handler, lastRpc;
const mock={storage:{from:()=>({})},rpc:async(name,args)=>{lastRpc={name,args};if(name==='phototeam_check_team_registration')return {data:'new',error:null};if(name==='phototeam_join_team_password')return {data:{status:args.p_confirmation===args.p_password?'ok':'confirmation',id:'t',room_id:'r',name:'Team'},error:null};throw Error('unexpected RPC')}};
let source=fs.readFileSync('supabase/functions/phototeam/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');source=stripTypeScriptTypes(source,{mode:'strip'});new Function('Deno','createClient',...Object.keys(security),source)({env:{get:k=>k==='SUPABASE_URL'?'https://test.invalid':k==='SUPABASE_SECRET_KEYS'?'{"default":"secret"}':null},serve:f=>handler=f},()=>mock,...Object.values(security));
const request=body=>new Request('https://test.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
let response=await handler(request({action:'team_check',code:'123456',name:'Team'}));assert.equal(response.status,200);assert.equal((await response.json()).status,'new');assert.equal(lastRpc.name,'phototeam_check_team_registration');
response=await handler(request({action:'join',code:'123456',name:'Team',password:'123',confirmation:'123'}));assert.equal(response.status,400);
response=await handler(request({action:'join',code:'123456',name:'Team',password:'1234',confirmation:'1234'}));assert.equal(response.status,200);
response=await handler(request({action:'join',code:'123456',name:'Team',password:'password123',confirmation:'different'}));assert.equal(response.status,400);
response=await handler(request({action:'join',code:'123456',name:'Team',password:'password123',confirmation:'password123'}));assert.equal(response.status,200);const result=await response.json();assert.match(result.token,/^[a-f0-9]{64}$/);assert.notEqual(lastRpc.args.p_new_hash,result.token);assert.equal(lastRpc.args.p_new_hash,await security.hashToken(result.token));
console.log('Team registration and token handling checks passed');

