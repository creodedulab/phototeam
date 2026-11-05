import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('live.html','utf8'), source=fs.readFileSync('live.js','utf8');
assert.match(html,/<script src="live\.js" defer><\/script>/);
const root={innerHTML:''};
const context={document:{getElementById:id=>id==='app'?root:null},sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null},setInterval:()=>{},console,Date,URL,Uint8Array,Uint32Array,Set,Math};
vm.runInNewContext(source,context);
assert.match(root.innerHTML,/포토팀빌딩/);
assert.match(root.innerHTML,/관리자 입장/);
assert.doesNotMatch(root.innerHTML,/관리자 체험 코드|ADMIN/);
assert.equal(vm.runInNewContext(`h('<script>"&')`,context), '&lt;script&gt;&quot;&amp;');
console.log('Client startup and HTML escaping checks passed');

