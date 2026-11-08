import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const root={innerHTML:''};const ctx={document:{getElementById:id=>id==='app'?root:null},sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null},setInterval:()=>{},console,Date,URL,Uint8Array,Uint32Array,Set,Math};
vm.runInNewContext(fs.readFileSync('live.js','utf8'),ctx);
vm.runInNewContext(`appState.reportSettings={program:'<행사>',date:'2026-11-08',place:'서울'};appState.teams=[{id:'a',name:'A팀'},{id:'b',name:'B팀'}];appState.missions=Array.from({length:5},(_,i)=>({id:'m'+i,position:i+1,title:'미션 '+i}));appState.submissions=[...appState.missions.map(m=>({team_id:'a',mission_id:m.id,photo_url:'https://test.invalid/a.jpg',title:'제목',description:'설명',message:'한마디'})),{team_id:'b',mission_id:'m0',photo_url:'https://test.invalid/b.jpg',title:'제목',description:'설명',message:'한마디'}]`,ctx);
let markup=vm.runInNewContext('reportPagesMarkup()',ctx);assert.equal((markup.match(/class="report-page"/g)||[]).length,3);assert.equal((markup.match(/class="report-card"/g)||[]).length,6);assert.equal((markup.match(/크레오디교육연구소/g)||[]).length,3);assert.match(markup,/&lt;행사&gt;/);assert.match(markup,/A팀/);assert.match(markup,/B팀/);
console.log('Report grouping, page count, footer and escaping checks passed');

