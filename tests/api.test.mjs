import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as security from '../supabase/functions/phototeam/security.ts';
let handler, queries=[], roomStatus='running', signedCount=0, roomEnd;
const future=new Date(Date.now()+60000).toISOString();
roomEnd=future;
class Query {
 constructor(table){this.table=table;this.columns=''}
 select(columns){this.columns=columns;queries.push({table:this.table,columns});return this}
 eq(){return this} order(){return this} limit(){return this} maybeSingle(){return this.result()} single(){return this.result()}
 then(resolve,reject){return this.result().then(resolve,reject)}
 async result(){if(this.table==='admin_sessions')return {data:{expires_at:future},error:null};if(this.table==='rooms')return {data:{id:'room',status:roomStatus,ends_at:roomEnd},error:null};if(this.table==='room_missions'||this.table==='teams'||this.table==='restart_photo_cleanup')return {data:[],error:null};if(this.table==='submissions')return {data:this.columns.includes('photo_path')?[{photo_path:'private/photo.jpg'}]:[],error:null};throw Error('Unexpected table '+this.table)}
}
const mock={from:t=>{assert.match(t,/^phototeam_/);return new Query(t.slice(10))},storage:{from:()=>({createSignedUrl:async()=>{signedCount++;return {data:{signedUrl:'https://test.invalid/signed'},error:null}}})}};
let source=fs.readFileSync('supabase/functions/phototeam/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
source=stripTypeScriptTypes(source,{mode:'strip'});
const fakeDeno={env:{get:k=>k==='SUPABASE_URL'?'https://test.invalid':k==='SUPABASE_SECRET_KEYS'?'{"default":"secret"}':null},serve:f=>handler=f};
new Function('Deno','createClient',...Object.keys(security),source)(fakeDeno,()=>mock,...Object.values(security));
const request=body=>new Request('https://test.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
let response=await handler(request({action:'admin_room',token:'invalid',room_id:'room'}));assert.equal(response.status,401);
response=await handler(request({action:'admin_room',token:'a'.repeat(64),room_id:'room'}));assert.equal(response.status,200);
let q=queries.find(x=>x.table==='submissions');assert.equal(q.columns,'id,team_id,mission_id');
queries=[];response=await handler(request({action:'admin_room',token:'a'.repeat(64),room_id:'room',include_photos:true}));assert.equal(response.status,200);assert.equal(signedCount,0);assert.equal(queries.find(x=>x.table==='submissions').columns,'id,team_id,mission_id');
roomEnd=new Date(Date.now()-1000).toISOString();queries=[];response=await handler(request({action:'admin_room',token:'a'.repeat(64),room_id:'room',include_photos:true}));assert.equal(response.status,200);assert.equal(signedCount,0);assert.equal(queries.find(x=>x.table==='submissions').columns,'id,team_id,mission_id');
roomStatus='ended';queries=[];response=await handler(request({action:'admin_room',token:'a'.repeat(64),room_id:'room',light:true}));assert.equal(response.status,200);assert.equal(signedCount,0);
response=await handler(request({action:'admin_room',token:'a'.repeat(64),room_id:'room',include_photos:true}));assert.equal(response.status,200);assert.equal(signedCount,1);
console.log('Authorization and running-event privacy checks passed');

