import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as security from '../supabase/functions/phototeam/security.ts';
let handler, queries=[];
const future=new Date(Date.now()+60000).toISOString();
class Query {
 constructor(table){this.table=table;this.columns=''}
 select(columns){this.columns=columns;queries.push({table:this.table,columns});return this}
 eq(){return this} order(){return this} maybeSingle(){return this.result()} single(){return this.result()}
 then(resolve,reject){return this.result().then(resolve,reject)}
 async result(){if(this.table==='admin_sessions')return {data:{expires_at:future},error:null};if(this.table==='rooms')return {data:{id:'room',status:'running',ends_at:future},error:null};if(this.table==='room_missions'||this.table==='teams'||this.table==='submissions')return {data:[],error:null};throw Error('Unexpected table '+this.table)}
}
const mock={from:t=>new Query(t),storage:{from:()=>({createSignedUrl:()=>{throw Error('Photo must not be signed while running')}})}};
let source=fs.readFileSync('supabase/functions/phototeam/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
source=stripTypeScriptTypes(source,{mode:'strip'});
const fakeDeno={env:{get:k=>k==='SUPABASE_URL'?'https://test.invalid':k==='SUPABASE_SECRET_KEYS'?'{"default":"secret"}':null},serve:f=>handler=f};
new Function('Deno','createClient',...Object.keys(security),source)(fakeDeno,()=>mock,...Object.values(security));
const request=body=>new Request('https://test.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
let response=await handler(request({action:'admin_room',token:'invalid',room_id:'room'}));assert.equal(response.status,401);
response=await handler(request({action:'admin_room',token:'a'.repeat(64),room_id:'room'}));assert.equal(response.status,200);
let q=queries.find(x=>x.table==='submissions');assert.equal(q.columns,'id,team_id,mission_id');
console.log('Authorization and running-event privacy checks passed');

