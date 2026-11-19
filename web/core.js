const textSegmenter = new Intl.Segmenter('ru',{granularity:'grapheme'});
export const countText = s => [...textSegmenter.segment(s)].length;
export const cleanText = s => String(s).replace(/[\r\n]+/g,' ').trim();
export function validateText(s){const text=cleanText(s);if(!text)throw Error('Введите задачу');if(countText(text)>80)throw Error('Максимум 80 символов');return text;}
export function fresh(){return {version:2,tasks:[],imports:[],draft:null,settings:{topmost:true,confirmDelete:true,showDone:true,color:'#D7E6EC',transparency:40,mode:'full',icon:null,geometry:{}},cleanup:{boundary:0,boot:null},trayHintSeen:false};}
export function validateDocument(s){
 if(!s||![1,2].includes(s.version)||!Array.isArray(s.tasks)||!s.settings||!s.cleanup)throw Error('Формат файла данных не поддерживается');
 s=JSON.parse(JSON.stringify(s));
 if(s.version===1){s.version=2;s.imports=[];}
 if(!Array.isArray(s.imports))throw Error('Сохранённые импорты повреждены');
 const ids=new Set();for(const t of s.tasks){if(typeof t.id!=='string'||ids.has(t.id)||typeof t.text!=='string'||validateText(t.text)!==t.text||typeof t.done!=='boolean'||!Number.isFinite(t.order)||t.done&&(!Number.isFinite(t.completedAt)||typeof t.boot!=='string'))throw Error('Файл задач повреждён');ids.add(t.id);}
 if(s.draft!==null&&(!s.draft||typeof s.draft.text!=='string'||!(s.draft.id===null||ids.has(s.draft.id))))throw Error('Черновик повреждён');
 const q=s.settings;if(typeof q.topmost!=='boolean'||typeof q.confirmDelete!=='boolean'||typeof q.showDone!=='boolean'||!/^#[0-9a-f]{6}$/i.test(q.color)||!Number.isFinite(q.transparency)||q.transparency<0||q.transparency>70||!['full','compact'].includes(q.mode)||!(q.icon===null||/^icon-[a-f0-9-]+\.(png|jpg|gif)$/.test(q.icon)))throw Error('Настройки повреждены');
 if(!q.geometry||!Number.isFinite(s.cleanup.boundary)||!(s.cleanup.boot===null||typeof s.cleanup.boot==='string'))throw Error('Служебные данные повреждены');
 const importIds=new Set(),names=new Set();
 for(const entry of s.imports){
  if(!entry||typeof entry.id!=='string'||!entry.id||importIds.has(entry.id)||typeof entry.name!=='string'||!entry.name.trim()||entry.name!==entry.name.trim()||countText(entry.name)>80||names.has(nameKey(entry.name))||!Array.isArray(entry.tasks)||!entry.tasks.length||entry.tasks.some(t=>typeof t!=='string'||validateText(t)!==t))throw Error('Сохранённые импорты повреждены');
  importIds.add(entry.id);names.add(nameKey(entry.name));
 }
 for(const task of s.tasks)if(task.batchId!==undefined&&typeof task.batchId!=='string'||task.sourceImportId!==undefined&&!importIds.has(task.sourceImportId))throw Error('Партия задач повреждена');
 return s;
}
export function rows(s){return s.tasks.filter(t=>s.settings.showDone||!t.done).sort((a,b)=>Number(a.done)-Number(b.done)||a.order-b.order);}
export function startDraft(s,id=null){if(s.draft)return;s.draft={id,text:id?s.tasks.find(t=>t.id===id).text:''};}
export function saveDraft(s,id){if(!s.draft)return;const text=validateText(s.draft.text);if(s.draft.id){const t=s.tasks.find(t=>t.id===s.draft.id);if(t)t.text=text;}else{s.tasks.push({id,text,done:false,order:Math.max(-1,...s.tasks.map(t=>t.order))+1,completedAt:null,boot:null});}s.draft=null;}
export function removeTask(s,id){s.tasks=s.tasks.filter(t=>t.id!==id);if(s.draft?.id===id)s.draft=null;}
export function toggleTask(s,id,now,boot){const t=s.tasks.find(t=>t.id===id);if(!t)return;t.done=!t.done;t.completedAt=t.done?now:null;t.boot=t.done?(boot??'unknown'):null;}
export function boundaryAt(now){const d=new Date(now);d.setHours(9,0,0,0);if(d.getTime()>now)d.setDate(d.getDate()-1);return d.getTime();}
export function cleanup(s,now,boot){
 const boundary=boundaryAt(now),due=boundary>s.cleanup.boundary,newBoot=!!boot&&s.cleanup.boot!==boot;let changed=false;
 const prev=s.tasks.length;s.tasks=s.tasks.filter(t=>!t.done||!(due&&t.completedAt<=boundary||newBoot&&t.boot!=='unknown'&&t.boot!==boot));changed=prev!==s.tasks.length;
 if(s.draft?.id&&!s.tasks.some(t=>t.id===s.draft.id))s.draft=null;
 if(due){s.cleanup.boundary=boundary;changed=true;}if(boot&&s.cleanup.boot!==boot){s.cleanup.boot=boot;changed=true;}return changed;
}
export function fitGeometry(g,monitors,mode){const m=monitors.find(m=>g&&g.x<m.x+m.width&&g.x+(g.width??320)>m.x&&g.y<m.y+m.height&&g.y+(g.height??470)>m.y)??monitors[0];if(!m)return null;const width=mode==='compact'?100:Math.min(Math.max(320,g?.width??320),m.width);const height=mode==='compact'?100:Math.min(Math.max(320,g?.height??470),m.height);return {x:Math.min(Math.max(g?.x??m.x+m.width-width-24,m.x),m.x+m.width-width),y:Math.min(Math.max(g?.y??m.y+24,m.y),m.y+m.height-height),width,height};}

export const nameKey = name => name.trim().toLocaleLowerCase('ru');
export function validateImportName(s,name){
 if(typeof name!=='string'||!name.trim())throw Error('Введите имя списка задач');
 name=name.trim();if(countText(name)>80)throw Error('Имя — не больше 80 символов');
 if(s.imports.some(entry=>nameKey(entry.name)===nameKey(name)))throw Error('Такое имя уже есть. Укажите другое.');
 return name;
}
export function suggestedImportName(s,filename){
 const base=String(filename).replace(/\.txt$/i,'').trim()||'Новый список';
 const parts=[...new Intl.Segmenter('ru',{granularity:'grapheme'}).segment(base)].map(p=>p.segment);
 let name=parts.slice(0,80).join(''),n=2;
 while(s.imports.some(e=>nameKey(e.name)===nameKey(name))){const suffix=' ('+n+++')';name=parts.slice(0,80-countText(suffix)).join('')+suffix;}
 return name;
}
export function parseTxt(text){
 if(typeof text!=='string'||text.includes('\0'))throw Error('Выберите текстовый файл UTF-8');
 const records=[];
 for(const [i,line] of text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/).entries()){
  const value=line.trim();if(!value)continue;
  if(records.length>=5000)throw Error('Максимум 5000 задач в одном TXT');
  records.push({line:i+1,text:value,valid:countText(value)<=80});
 }
 return records;
}
export function reviseImportRow(records,index,text){
 const value=validateText(text);if(!records[index])throw Error('Строка не найдена');
 records[index]={...records[index],text:value,valid:true};
}
function batch(texts,sourceImportId,s,idFactory){
 const batchId=idFactory(),used=new Set(s.tasks.map(t=>t.id));
 let order=Math.max(-1,...s.tasks.map(t=>t.order));
 const tasks=texts.map(value=>{const text=validateText(value),id=idFactory();if(used.has(id))throw Error('Повтор идентификатора задачи');used.add(id);return {id,text,done:false,order:++order,completedAt:null,boot:null,batchId,sourceImportId};});
 return {batchId,tasks,count:tasks.length,importId:sourceImportId};
}
export function saveImport(s,name,records,idFactory=()=>crypto.randomUUID()){
 name=validateImportName(s,name);const texts=records.filter(r=>r.valid).map(r=>validateText(r.text));
 if(!texts.length)throw Error('В файле нет подходящих задач');
 const id=idFactory();if(s.imports.some(e=>e.id===id))throw Error('Повтор идентификатора импорта');
 const added=batch(texts,id,s,idFactory);
 s.imports.push({id,name,tasks:[...texts]});s.tasks.push(...added.tasks);
 return added;
}
export function repeatImport(s,id,idFactory=()=>crypto.randomUUID()){
 const entry=s.imports.find(e=>e.id===id);if(!entry)throw Error('Сохранённый импорт не найден');
 const added=batch(entry.tasks,id,s,idFactory);s.tasks.push(...added.tasks);return added;
}
export function removeBatch(s,id){const ids=new Set(s.tasks.filter(t=>t.batchId===id).map(t=>t.id));s.tasks=s.tasks.filter(t=>!ids.has(t.id));if(ids.has(s.draft?.id))s.draft=null;}
export function restoreTask(s,task){
 if(s.tasks.some(t=>t.id===task.id)||task.done&&task.completedAt<=s.cleanup.boundary)return false;
 if(s.tasks.some(t=>t.order===task.order))for(const t of s.tasks)if(t.order>=task.order)t.order++;
 s.tasks.push({...task});return true;
}
export function compactTarget(rect,scale,area){const size=Math.round(100*scale);return {x:Math.round(Math.min(Math.max(rect.x+rect.width-size,area.x),area.x+area.width-size)),y:Math.round(Math.min(Math.max(rect.y,area.y),area.y+area.height-size)),width:size,height:size};}
export function makeSaver(write,status){let chain=Promise.resolve();let revision=0;const saver=snapshot=>{const own=++revision;status('saving');const copy=JSON.parse(JSON.stringify(snapshot));const job=chain.catch(()=>{}).then(()=>write(copy));chain=job;return job.then(()=>{if(own===revision)status('saved');},e=>{if(own===revision)status('error',e);throw e;});};saver.dirty=()=>{revision++;status('saving');};return saver;}
