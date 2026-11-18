export const countText = s => [...new Intl.Segmenter('ru',{granularity:'grapheme'}).segment(s)].length;
export const cleanText = s => String(s).replace(/[\r\n]+/g,' ').trim();
export function validateText(s){const text=cleanText(s);if(!text)throw Error('Введите задачу');if(countText(text)>80)throw Error('Максимум 80 символов');return text;}
export function fresh(){return {version:1,tasks:[],draft:null,settings:{topmost:true,confirmDelete:true,showDone:true,color:'#D2E8F7',transparency:40,mode:'full',icon:null,geometry:{}},cleanup:{boundary:0,boot:null},trayHintSeen:false};}
export function validateDocument(s){
 if(!s||s.version!==1||!Array.isArray(s.tasks)||!s.settings||!s.cleanup)throw Error('Формат файла данных не поддерживается');
 const ids=new Set();for(const t of s.tasks){if(typeof t.id!=='string'||ids.has(t.id)||typeof t.text!=='string'||validateText(t.text)!==t.text||typeof t.done!=='boolean'||!Number.isFinite(t.order)||t.done&&(!Number.isFinite(t.completedAt)||typeof t.boot!=='string'))throw Error('Файл задач повреждён');ids.add(t.id);}
 if(s.draft!==null&&(!s.draft||typeof s.draft.text!=='string'||!(s.draft.id===null||ids.has(s.draft.id))))throw Error('Черновик повреждён');
 const q=s.settings;if(typeof q.topmost!=='boolean'||typeof q.confirmDelete!=='boolean'||typeof q.showDone!=='boolean'||!/^#[0-9a-f]{6}$/i.test(q.color)||!Number.isFinite(q.transparency)||q.transparency<0||q.transparency>70||!['full','compact'].includes(q.mode)||!(q.icon===null||/^icon-[a-f0-9-]+\.(png|jpg|gif)$/.test(q.icon)))throw Error('Настройки повреждены');
 if(!q.geometry||!Number.isFinite(s.cleanup.boundary)||!(s.cleanup.boot===null||typeof s.cleanup.boot==='string'))throw Error('Служебные данные повреждены');return s;
}
export function rows(s){return s.tasks.filter(t=>s.settings.showDone||!t.done).sort((a,b)=>Number(a.done)-Number(b.done)||a.order-b.order);}
export function startDraft(s,id=null){if(s.draft)return;s.draft={id,text:id?s.tasks.find(t=>t.id===id).text:''};}
export function saveDraft(s,id){if(!s.draft)return;const text=validateText(s.draft.text);if(s.draft.id){const t=s.tasks.find(t=>t.id===s.draft.id);if(t)t.text=text;}else{s.tasks.push({id,text,done:false,order:Math.max(-1,...s.tasks.map(t=>t.order))+1,completedAt:null,boot:null});}s.draft=null;}
export function removeTask(s,id){s.tasks=s.tasks.filter(t=>t.id!==id);if(s.draft?.id===id)s.draft=null;}
export function toggleTask(s,id,now,boot){const t=s.tasks.find(t=>t.id===id);if(!t)return;t.done=!t.done;t.completedAt=t.done?now:null;t.boot=t.done?(boot??'unknown'):null;}
export function boundaryAt(now){const d=new Date(now);d.setHours(9,0,0,0);if(d.getTime()>now)d.setDate(d.getDate()-1);return d.getTime();}
export function cleanup(s,now,boot){
 const boundary=boundaryAt(now),due=boundary>s.cleanup.boundary,newBoot=!!boot&&s.cleanup.boot!==boot;let changed=false;
 const prev=s.tasks.length;s.tasks=s.tasks.filter(t=>!t.done||!(due&&t.completedAt<=boundary||newBoot&&t.boot!==boot));changed=prev!==s.tasks.length;
 if(s.draft?.id&&!s.tasks.some(t=>t.id===s.draft.id))s.draft=null;
 if(due){s.cleanup.boundary=boundary;changed=true;}if(boot&&s.cleanup.boot!==boot){s.cleanup.boot=boot;changed=true;}return changed;
}
export function fitGeometry(g,monitors,mode){const m=monitors.find(m=>g&&g.x<m.x+m.width&&g.x+(g.width??380)>m.x&&g.y<m.y+m.height&&g.y+(g.height??640)>m.y)??monitors[0];if(!m)return null;const width=mode==='compact'?100:Math.min(Math.max(340,g?.width??380),m.width);const height=mode==='compact'?100:Math.min(Math.max(320,g?.height??640),m.height);return {x:Math.min(Math.max(g?.x??m.x+m.width-width-24,m.x),m.x+m.width-width),y:Math.min(Math.max(g?.y??m.y+24,m.y),m.y+m.height-height),width,height};}
export function makeSaver(write,status){let chain=Promise.resolve();let revision=0;return snapshot=>{const own=++revision;status('saving');const copy=JSON.parse(JSON.stringify(snapshot));const job=chain.catch(()=>{}).then(()=>write(copy));chain=job;return job.then(()=>{if(own===revision)status('saved');},e=>{if(own===revision)status('error',e);throw e;});};}
