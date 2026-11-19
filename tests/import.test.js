import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,validateDocument,parseTxt,saveImport,repeatImport,removeBatch,restoreTask,removeTask,rows,validateImportName,suggestedImportName,reviseImportRow,countText,compactTarget} from '../web/core.js';

const ids=()=>{let i=0;return()=>`id-${++i}`;};
test('version 1 migration keeps tasks, draft and settings without changing source',()=>{
 const old=fresh();old.version=1;delete old.imports;
 old.tasks=[{id:'old',text:'Существующая',done:false,order:0,completedAt:null,boot:null}];old.draft={id:'old',text:'Черновик'};old.settings.color='#AABBCC';
 const migrated=validateDocument(old);
 assert.equal(migrated.version,2);assert.deepEqual(migrated.imports,[]);assert.deepEqual(migrated.tasks,old.tasks);assert.deepEqual(migrated.draft,old.draft);assert.equal(migrated.settings.color,'#AABBCC');assert.equal(old.version,1);
 assert.throws(()=>validateDocument({...old,version:3}));
});
test('TXT: BOM, CRLF/LF/CR, blank lines, literal markdown and grapheme limits',()=>{
 const r=parseTxt('\uFEFF Первое \r\n\r\n- [x] обычный текст\n'+'👨‍👩‍👧‍👦'.repeat(80)+'\r'+'я'.repeat(81));
 assert.deepEqual(r.map(x=>x.line),[1,3,4,5]);assert.equal(r[0].text,'Первое');assert.equal(r[1].text,'- [x] обычный текст');assert.equal(r[2].valid,true);assert.equal(r[3].valid,false);assert.equal(r[3].text.length,81);assert.deepEqual(parseTxt(' \r\n\t'),[]);assert.throws(()=>parseTxt('a\0b'));
 reviseImportRow(r,3,'Я'.repeat(80));assert.equal(r[3].valid,true);assert.equal(countText(r[3].text),80);
});
test('new import saves only valid texts; snapshots are independent and survive reload',()=>{
 const s=fresh(),next=ids();const result=saveImport(s,'  Рабочий список  ',parseTxt('Первая\nВторая\n'+'я'.repeat(81)),next);
 assert.equal(result.count,2);assert.equal(s.imports[0].name,'Рабочий список');assert.ok(s.tasks.every(t=>!t.done));
 s.tasks[0].text='Изменённая';removeTask(s,s.tasks[1].id);
 const reloaded=validateDocument(JSON.parse(JSON.stringify(s)));
 const added=repeatImport(reloaded,s.imports[0].id,next);
 assert.equal(added.count,2);assert.deepEqual(reloaded.tasks.slice(-2).map(t=>t.text),['Первая','Вторая']);assert.equal(reloaded.imports.length,1);
 assert.equal(new Set(reloaded.tasks.map(t=>t.id)).size,3);
});
test('name validation and invalid/empty import do not partially mutate the document',()=>{
 const s=fresh(),next=ids();saveImport(s,'Список',parseTxt('Первая'),next);const before=JSON.stringify(s);
 assert.throws(()=>saveImport(s,'  СПИСОК ',parseTxt('Вторая'),next),/уже есть/);
 assert.throws(()=>saveImport(s,'Новый',parseTxt('я'.repeat(81)),next));
 assert.throws(()=>saveImport(s,'Пустой',[],next));assert.throws(()=>validateImportName(s,' '));assert.throws(()=>validateImportName(s,'я'.repeat(81)));
 assert.equal(JSON.stringify(s),before);assert.equal(suggestedImportName(s,'Список.TXT'),'Список (2)');
});
test('repeated import gets fresh IDs and undo removes only its batch, leaving the snapshot',()=>{
 const s=fresh(),next=ids();saveImport(s,'Список',parseTxt('Одна\nДве'),next);
 const original=s.tasks.map(t=>t.id),a=repeatImport(s,s.imports[0].id,next),b=repeatImport(s,s.imports[0].id,next);
 assert.equal(s.tasks.length,6);assert.notEqual(a.batchId,b.batchId);removeBatch(s,a.batchId);
 assert.equal(s.tasks.length,4);assert.deepEqual(s.tasks.slice(0,2).map(t=>t.id),original);assert.equal(s.tasks.filter(t=>t.batchId===b.batchId).length,2);assert.equal(s.imports.length,1);
});
test('manual deletion undo restores ID, completion and original order',()=>{
 const s=fresh(),next=ids();saveImport(s,'Список',parseTxt('Одна\nДве'),next);const t={...s.tasks[0]};t.done=true;t.completedAt=Date.now();t.boot='boot';s.tasks[0]={...t};removeTask(s,t.id);assert.equal(restoreTask(s,t),true);assert.equal(restoreTask(s,t),false);assert.deepEqual(s.tasks.find(v=>v.id===t.id),t);assert.equal(rows(s).at(-1).id,t.id);
});
test('damaged saved imports and references fail rather than overwriting valid data',()=>{
 const s=fresh(),next=ids();saveImport(s,'Список',parseTxt('Одна'),next);s.imports.push({...s.imports[0],id:'different',name:' СПИСОК '});assert.throws(()=>validateDocument(s));
 s.imports.pop();s.tasks[0].sourceImportId='missing';assert.throws(()=>validateDocument(s));
});
test('compact anchor uses the current top-right at scaled/negative monitor positions',()=>{
 const result=compactTarget({x:-1000,y:140,width:600,height:900},1.5,{x:-1920,y:0,width:1920,height:1560});assert.deepEqual(result,{x:-550,y:140,width:150,height:150});
 const clamped=compactTarget({x:1850,y:1050,width:480,height:700},1,{x:0,y:0,width:1920,height:1080});assert.deepEqual(clamped,{x:1820,y:980,width:100,height:100});
});

test('deletion undo cannot resurrect an already expired completed task',()=>{
 const s=fresh();s.cleanup.boundary=100;
 assert.equal(restoreTask(s,{id:'expired',text:'Старое',done:true,completedAt:99,boot:'old',order:0}),false);
 assert.equal(s.tasks.length,0);
});

test('dirty input invalidates an older write before the debounce queues a new snapshot',async()=>{
 const {makeSaver}=await import('../web/core.js');let release;const events=[];
 const save=makeSaver(()=>new Promise(r=>{release=r;}),status=>events.push(status));
 const old=save({text:''});await Promise.resolve();await Promise.resolve();save.dirty();release();await old;
 assert.equal(events.at(-1),'saving');assert.equal(events.includes('saved'),false);
});
