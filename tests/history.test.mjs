import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const handlers={}, root={innerHTML:''}, fields={title:{value:''},description:{value:''},message:{value:''}};
const entries=[];let pointer=-1, accept=true, moves=[];
const history={get state(){return entries[pointer]?.state},replaceState(state,_,url){if(pointer<0){pointer=0;entries[0]={state,url}}else entries[pointer]={state,url}},pushState(state,_,url){entries.splice(pointer+1);entries.push({state,url});pointer++},go(delta){moves.push(delta)}};
const context={history,location:{pathname:'/',search:''},window:{addEventListener:(type,fn)=>handlers[type]=fn},document:{getElementById:id=>id==='app'?root:fields[id]||null},sessionStorage:{getItem:()=>null},localStorage:{getItem:key=>key==='pt-team-123456'?'token':null},setInterval:()=>{},confirm:()=>accept,console,Date,URL,Uint8Array,Uint32Array,Set,Math};
vm.runInNewContext(fs.readFileSync('live.js','utf8'),context);
vm.runInNewContext(`call=async(action)=>{if(action==='team_state')return {room:{id:'room',name:'Test',status:'running',ends_at:'2099-01-01T00:00:00Z'},team:{name:'Team'},missions:[{id:'mission',position:1,title:'Test',description:'Description'}],submissions:[]};throw Error(action)}`,context);
assert.equal(entries.length,1);
vm.runInNewContext(`appState.teamToken='token';appState.teamCode='123456'`,context);
await vm.runInNewContext('teamPage()',context);
assert.equal(history.state.route.page,'team');assert.equal(history.state.route.teamCode,'123456');
vm.runInNewContext(`missionPage('mission')`,context);
assert.equal(history.state.route.page,'mission');assert.equal(entries.length,3);
fields.title.value='새 제목';accept=false;
await handlers.popstate({state:entries[1].state});
assert.deepEqual(moves,[1]);assert.equal(vm.runInNewContext('appState.page',context),'mission');assert.equal(fields.title.value,'새 제목');
await handlers.popstate({state:entries[2].state}); // Return to the original history position.
accept=true;pointer=1;await handlers.popstate({state:entries[1].state});
assert.equal(vm.runInNewContext('appState.page',context),'team');assert.equal(entries.length,3);
pointer=2;await handlers.popstate({state:entries[2].state});
assert.equal(vm.runInNewContext('appState.page',context),'mission');assert.equal(entries.length,3);
fields.title.value='임시 작성';accept=false;
await vm.runInNewContext('teamPage()',context);
assert.equal(vm.runInNewContext('appState.page',context),'mission');
assert.equal(fields.title.value,'임시 작성');
const refreshed={...history.state.route};
vm.runInNewContext(`appState.teamToken='';appState.teamCode='';appState.page='home'`,context);
await vm.runInNewContext(`restoringRoute=true;restoreRoute(${JSON.stringify(refreshed)})`,context);
assert.equal(vm.runInNewContext('appState.page',context),'mission');
assert.equal(vm.runInNewContext('appState.teamCode',context),'123456');
assert.equal(entries.length,3);
console.log('History, dirty navigation cancellation, back and forward checks passed');

