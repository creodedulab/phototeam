import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root={innerHTML:''},photo={hidden:true},name={},fields={title:{value:''},description:{value:''},message:{value:''}};let message='',revoked=[];
const ctx={document:{getElementById:id=>id==='app'?root:id==='photoPreview'?photo:id==='photoName'?name:fields[id]||null},sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null},setInterval:()=>{},console,Date,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:url=>revoked.push(url)},Uint8Array,Uint32Array,Set,Math,alert:x=>message=x};
vm.runInNewContext(fs.readFileSync('live.js','utf8'),ctx);
vm.runInNewContext(`appState.room={status:'running',ends_at:'2099-01-01T00:00:00Z'};appState.missions=[{id:'m',title:'미션',position:1}];appState.submissions=[];missionPage('m')`,ctx);
assert.match(root.innerHTML,/id="photoPreview"/);
vm.runInNewContext(`pickPhoto({files:[{name:'example.jpg'}]})`,ctx);
assert.equal(photo.src,'blob:test');assert.equal(photo.hidden,false);
vm.runInNewContext(`pickPhoto({files:[{name:'another.jpg'}]})`,ctx);
assert.deepEqual(revoked,['blob:test']);
vm.runInNewContext(`appState.teams=[{id:'a',name:'A'},{id:'b',name:'B'}];appState.submissions=[{team_id:'a',mission_id:'m',photo_url:'x',title:'a'},{team_id:'b',mission_id:'m',photo_url:'y',title:'b'}];openPresentation('b')`,ctx);
assert.equal(vm.runInNewContext('slides().length',ctx),1);
assert.match(root.innerHTML,/>B</);assert.doesNotMatch(root.innerHTML,/>A</);
vm.runInNewContext('nextPresentation()',ctx);assert.equal(message,'마지막입니다.');
console.log('Photo preview and team-specific presentation checks passed');

