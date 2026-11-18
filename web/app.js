import {fresh,validateDocument,validateText,countText,rows,startDraft,saveDraft,removeTask,toggleTask,cleanup,fitGeometry,makeSaver} from './core.js';
const $=id=>document.getElementById(id);
const tauri=window.__TAURI__,native=!!tauri,invoke=(name,args)=>tauri.core.invoke(name,args);
let state=fresh(),boot=null,status='saved',pendingDelete=null,geometryBusy=false,ready=false,iconUrl='assets/duck.svg',draftTimer,unlisten=[];
const win=native?tauri.window.getCurrentWindow():null;
const writeState=async value=>native?invoke('save_state',{value}):localStorage.setItem('checkoverlay-preview',JSON.stringify(value));
const save=makeSaver(writeState,(value,error)=>{status=value;$('saveStatus').textContent=value==='saved'?'Сохранено на компьютере':value==='saving'?'Сохраняем…':'Не удалось сохранить';$('retry').hidden=value!=='error';if(error)message(error);});
function message(error){$('message').textContent=String(error?.message??error);$('message').hidden=false;}
function persist(){return save(state).catch(e=>{message(e);throw e;});}
function scheduleDraft(){status='saving';$('saveStatus').textContent='Сохраняем…';clearTimeout(draftTimer);draftTimer=setTimeout(()=>persist().catch(()=>{}),180);}
function button(label,title,fn){const e=document.createElement('button');e.type='button';e.textContent=label;e.title=title;e.setAttribute('aria-label',title);e.onclick=fn;return e;}
function afterMutation(){render();persist().catch(()=>{});}
function requestDelete(id){if(!state.tasks.some(t=>t.id===id))return;if(!state.settings.confirmDelete){removeTask(state,id);afterMutation();return;}pendingDelete=id;$('dontAsk').checked=false;$('deleteDialog').showModal();$('no').focus();}
function editor(row,draft){
 const wrap=document.createElement('div');wrap.className='editor';
 const field=document.createElement('div');field.className='input-wrap';
 const input=document.createElement('textarea');input.className='draft-input';input.rows=1;input.value=draft.text;input.setAttribute('aria-label',draft.id?'Изменить задачу':'Новая задача');
 const counter=document.createElement('div');counter.className='counter';counter.textContent=countText(draft.text)+' / 80';
 const err=document.createElement('div');err.className='error-text';err.setAttribute('role','alert');
 field.append(input,counter,err);
 const submit=()=>{try{saveDraft(state,crypto.randomUUID());clearTimeout(draftTimer);afterMutation();}catch(e){err.textContent=e.message;input.focus();}};
 const cancel=()=>{if(draft.id)requestDelete(draft.id);else{state.draft=null;clearTimeout(draftTimer);afterMutation();}};
 input.oninput=()=>{draft.text=input.value;counter.textContent=countText(input.value)+' / 80';err.textContent=countText(input.value)>80?'Максимум 80 символов':'';scheduleDraft();};
 input.onkeydown=e=>{if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();submit();}if(e.key==='Escape'){e.preventDefault();state.draft=null;clearTimeout(draftTimer);afterMutation();}};
 wrap.append(field,button('✓','Сохранить задачу',submit),button('×','Удалить строку',cancel));row.append(wrap);
 requestAnimationFrame(()=>{if(document.activeElement?.classList.contains('draft-input'))return;input.focus();input.setSelectionRange(input.value.length,input.value.length);row.scrollIntoView({block:'nearest'});});
}
function render(){
 const host=$('tasks');host.replaceChildren();
 for(const task of rows(state)){
  const row=document.createElement('div');row.className='row'+(task.done?' done':'');row.dataset.id=task.id;
  row.oncontextmenu=e=>{if(e.target.closest('textarea'))return;e.preventDefault();requestDelete(task.id);};
  if(state.draft?.id===task.id){editor(row,state.draft);}else{
   const check=button('',task.done?'Вернуть задачу в работу':'Отметить выполненной',()=>{toggleTask(state,task.id,Date.now(),boot);afterMutation();});check.className='task-toggle';check.setAttribute('role','checkbox');check.setAttribute('aria-checked',String(task.done));if(task.done){const img=document.createElement('img');img.src='assets/mini.svg';img.alt='';check.append(img);}
   const text=document.createElement('span');text.className='task-text';text.textContent=task.text;text.tabIndex=0;text.setAttribute('aria-label','Изменить: '+task.text);const edit=()=>{if(state.draft){$('tasks').querySelector('textarea')?.focus();return;}startDraft(state,task.id);render();persist().catch(()=>{});};text.ondblclick=edit;text.onkeydown=e=>{if(e.key==='Enter'||e.key==='F2'){e.preventDefault();edit();}};
   row.append(check,text);
  }host.append(row);
 }
 if(state.draft?.id===null){const r=document.createElement('div');r.className='row';editor(r,state.draft);host.append(r);}
 if(!state.tasks.length&&!state.draft){const p=document.createElement('p');p.textContent='Пока нет задач. Добавьте первое дело.';host.append(p);}
 $('count').textContent=state.tasks.filter(t=>t.done).length+' из '+state.tasks.length+' выполнено';
 $('add').disabled=!!state.draft;applyStyle();
}
function applyStyle(){const c=state.settings.color;const rgb=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));document.documentElement.style.setProperty('--tint',rgb.join(','));document.documentElement.style.setProperty('--surface',1-state.settings.transparency/100);}
async function updateIcon(){try{iconUrl=state.settings.icon?native?await invoke('read_icon',{name:state.settings.icon,reduceMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}):iconUrl:'assets/duck.svg';$('compactImage').src=iconUrl;$('previewIcon').src=iconUrl;}catch(e){message(e);$('compactImage').src='assets/duck.svg';$('previewIcon').src='assets/duck.svg';}}
async function rememberGeometry(){
 if(!native||geometryBusy||!ready)return;
 const p=await win.outerPosition(),size=await win.innerSize(),scale=await win.scaleFactor();
 state.settings.geometry[state.settings.mode]={x:p.x,y:p.y,width:size.width/scale,height:size.height/scale};
 persist().catch(()=>{});
}
async function setMode(mode){
 if(native&&ready&&!geometryBusy)await rememberGeometry();
 geometryBusy=true;
 try{
  if(native){
   await invoke('set_material',{compact:mode==='compact'});
   const monitors=await tauri.window.availableMonitors();
   const old=state.settings.geometry[mode];
   const primary=await tauri.window.primaryMonitor();
   const target=monitors.find(m=>old&&old.x>=m.workArea.position.x&&old.x<m.workArea.position.x+m.workArea.size.width&&old.y>=m.workArea.position.y&&old.y<m.workArea.position.y+m.workArea.size.height)??primary??monitors[0];
   if(target){const scale=target.scaleFactor;const area=target.workArea;
    const logical=fitGeometry(old?{x:old.x/scale,y:old.y/scale,width:old.width,height:old.height}:null,[{x:area.position.x/scale,y:area.position.y/scale,width:area.size.width/scale,height:area.size.height/scale}],mode);
    await win.setMinSize(null);await win.setMaxSize(null);await win.setResizable(mode==='full');await win.setSize(new tauri.dpi.LogicalSize(logical.width,logical.height));await win.setPosition(new tauri.dpi.PhysicalPosition(Math.round(logical.x*scale),Math.round(logical.y*scale)));
    if(mode==='full'){await win.setMinSize(new tauri.dpi.LogicalSize(Math.min(340,logical.width),Math.min(320,logical.height)));await win.setMaxSize(new tauri.dpi.LogicalSize(area.size.width/scale,area.size.height/scale));}
   }
  }
  state.settings.mode=mode;
  const compact=mode==='compact';$('app').classList.toggle('compact-mode',compact);$('compact').hidden=!compact;$('header').hidden=compact;$('full').hidden=compact;$('settings').hidden=true;await updateIcon();
  if(ready)await persist();
 }catch(e){message(e);}finally{geometryBusy=false;}
}
async function hide(){if(!state.trayHintSeen){alert('ЧекОверлей продолжит работать в трее. Нажмите на значок утёнка, чтобы вернуть список.');state.trayHintSeen=true;persist().catch(()=>{});}if(native)await win.hide();else message('В Windows окно скроется в трей. Здесь открыт просмотр интерфейса.');}
async function quit(){try{clearTimeout(draftTimer);await persist();await exit();}catch{$('exitDialog').showModal();}}
async function exit(){if(native)await invoke('quit_app');else message('Данные сохранены. Это просмотр интерфейса в браузере.');}
async function settings(){
 if(state.settings.mode==='compact')await setMode('full');
 for(const name of ['topmost','showDone','confirmDelete'])$(name).checked=state.settings[name];
 $('color').value=state.settings.color;$('transparency').value=state.settings.transparency;$('opacityLabel').value=state.settings.transparency+'%';
 if(native){try{$('autostart').checked=await invoke('autostart_enabled');}catch(e){message(e);}}
 $('full').hidden=true;$('settings').hidden=false;
}
$('add').onclick=()=>{startDraft(state);render();persist().catch(()=>{});};
$('yes').onclick=()=>{if(pendingDelete)removeTask(state,pendingDelete);$('deleteDialog').close();pendingDelete=null;afterMutation();};
$('no').onclick=()=>{$('deleteDialog').close();pendingDelete=null;};
$('dontAsk').onchange=e=>{state.settings.confirmDelete=!e.target.checked;persist().catch(()=>{});};
$('settingsButton').onclick=settings;$('back').onclick=()=>{$('settings').hidden=true;$('full').hidden=false;render();};
$('collapse').onclick=async()=>{await rememberGeometry();await setMode('compact');};
$('hide').onclick=()=>hide().catch(message);$('quit').onclick=quit;$('retry').onclick=()=>persist().catch(()=>{});
$('exitCancel').onclick=()=>$('exitDialog').close();$('exitRetry').onclick=async()=>{try{await persist();$('exitDialog').close();await exit();}catch{}};$('exitAnyway').onclick=exit;
for(const name of ['topmost','showDone','confirmDelete'])$(name).onchange=async e=>{const value=e.target.checked;try{if(name==='topmost'&&native)await invoke('set_topmost',{enabled:value});state.settings[name]=value;applyStyle();persist().catch(()=>{});}catch(err){e.target.checked=state.settings[name];message(err);}};
$('autostart').onchange=async e=>{if(!native){e.target.checked=false;message('Автозапуск доступен в приложении Windows.');return;}try{await invoke('set_autostart',{enabled:e.target.checked});}catch(err){message(err);}try{e.target.checked=await invoke('autostart_enabled');}catch(err){message(err);}};
$('color').oninput=e=>{state.settings.color=e.target.value;applyStyle();scheduleDraft();};
$('transparency').oninput=e=>{state.settings.transparency=Number(e.target.value);$('opacityLabel').value=e.target.value+'%';applyStyle();scheduleDraft();};
$('chooseImage').onclick=async()=>{if(!native){message('Выбор изображения доступен в приложении Windows.');return;}try{const name=await invoke('choose_image');if(name){state.settings.icon=name;await updateIcon();await persist();}}catch(e){message(e);}};
$('resetImage').onclick=()=>{state.settings.icon=null;updateIcon();persist().catch(()=>{});};
let pointer=null,dragged=false;
$('compact').onpointerdown=e=>{if(e.button!==0)return;pointer={x:e.clientX,y:e.clientY};dragged=false;$('compact').setPointerCapture(e.pointerId);};
$('compact').onpointermove=e=>{if(!pointer||dragged||Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)<5)return;dragged=true;pointer=null;if(native)win.startDragging().catch(message);};
$('compact').onpointerup=()=>{if(pointer&&!dragged)setMode('full');pointer=null;};
$('compact').oncontextmenu=e=>{e.preventDefault();if(native)invoke('popup_menu').catch(message);else settings();};
function recoverStart(value){try{state=validateDocument(value);$('recovery').close();bootAndRender().catch(message);}catch(e){$('recoveryError').textContent=String(e);}}
$('recover').onclick=async()=>{if(!native)return;try{const value=await invoke('recover_state');if(value)recoverStart(value);}catch(e){$('recoveryError').textContent=String(e);}};
$('startEmpty').onclick=async()=>{if(!confirm('Сохранить повреждённый файл отдельно и начать пустой список?'))return;try{if(native)await invoke('archive_corrupt');else localStorage.removeItem('checkoverlay-preview');recoverStart(fresh());}catch(e){$('recoveryError').textContent=String(e);}};
async function bootAndRender(){
 if(native){try{boot=await invoke('boot_id');}catch(e){message('Не удалось определить загрузку Windows: '+e);}}
 cleanup(state,Date.now(),boot);render();await setMode(state.settings.mode);if(native)await invoke('set_topmost',{enabled:state.settings.topmost});ready=true;await persist().catch(message);if(native)await win.show();
 if(native){
  let timer;const saveGeometry=()=>{clearTimeout(timer);timer=setTimeout(()=>rememberGeometry().catch(message),250);};
  unlisten.push(await win.onMoved(saveGeometry),await win.onResized(saveGeometry));

 }
 setInterval(()=>{if(cleanup(state,Date.now(),boot))afterMutation();},1000);
 window.addEventListener('focus',()=>{if(cleanup(state,Date.now(),boot))afterMutation();});
}
async function init(){
 if(native){
  unlisten.push(await tauri.event.listen('app-action',async e=>{try{if(!ready){if(e.payload==='quit'){await exit();return;}if(e.payload==='hide'){await win.hide();return;}await win.show();await win.setFocus();return;}if(e.payload==='show'){await setMode('full');await win.show();await win.setFocus();}if(e.payload==='compact')await setMode('compact');if(e.payload==='settings'){await settings();await win.show();await win.setFocus();}if(e.payload==='topmost'){const next=!state.settings.topmost;await invoke('set_topmost',{enabled:next});state.settings.topmost=next;$('topmost').checked=next;await persist();}if(e.payload==='hide')await hide();if(e.payload==='quit')await quit();}catch(err){message(err);}}));
 }

 if(!native)document.body.classList.add('browser-preview');
 try{const value=native?await invoke('load_state'):JSON.parse(localStorage.getItem('checkoverlay-preview')??'null');state=value?validateDocument(value):fresh();}
 catch(e){$('recoveryError').textContent=String(e);$('recovery').showModal();if(native)await win.show();return;}
 await bootAndRender();if(!native)message('Просмотр интерфейса. Задачи здесь хранятся отдельно от Windows-приложения.');
}
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>updateIcon());
init().catch(message);
