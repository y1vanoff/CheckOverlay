import {
  fresh, validateDocument, validateText, countText, rows, startDraft, saveDraft,
  removeTask, restoreTask, toggleTask, cleanup, fitGeometry, compactTarget, makeSaver,
  parseTxt, suggestedImportName, validateImportName, reviseImportRow, saveImport,
  repeatImport, removeBatch,
} from './core.js';

const $ = id => document.getElementById(id);
const tauri = window.__TAURI__;
const native = !!tauri;
const invoke = (name, args) => tauri.core.invoke(name, args);
const win = native ? tauri.window.getCurrentWindow() : null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let state = fresh(), boot = null, ready = false, view = 'full', geometryBusy = false;
let geometryDone = Promise.resolve();
let pendingDelete = null, importDraft = null, importEditing = null;
let operationBusy = false, operationPromise = null, retryOperation = null;
let draftTimer, undoTimer, hideToastTimer, undoRecord = null, notificationGeneration = 0;
let iconUrl = 'assets/duck.svg';
let saveActiveEditor = null;
let pointerInProgress = false, pendingEditorBlur = null;
function finishEditorPointer() {
  pointerInProgress = false;
  const finish = pendingEditorBlur; pendingEditorBlur = null; finish?.();
}
document.addEventListener('pointerdown',()=>{pointerInProgress=true;},true);
document.addEventListener('click',finishEditorPointer);
document.addEventListener('pointerup',()=>setTimeout(finishEditorPointer,0));
document.addEventListener('pointercancel',finishEditorPointer);

function message(error) {
  $('messageText').textContent = String(error?.message ?? error);
  $('message').hidden = false;
}
function clearMessage() { $('message').hidden = true; }
const writeState = value => native
  ? invoke('save_state', {value})
  : Promise.resolve(localStorage.setItem('checkoverlay-preview', JSON.stringify(value)));
const save = makeSaver(writeState, (status) => {
  document.documentElement.dataset.saveStatus = status;
  $('saveStatus').textContent = status === 'saved' ? 'Сохранено на компьютере'
    : status === 'saving' ? 'Сохраняем…' : 'Не удалось сохранить';
  $('saveFailure').hidden = status !== 'error';
});
function persist() { return save(state); }
function scheduleDraft() {
  save.dirty();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => persist().catch(message), 180);
}
function button(text, label, action, className = '') {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.className = className;
  b.title = label; b.setAttribute('aria-label', label);
  b.onclick = action;
  return b;
}
function glyphButton(kind, label, action) {
  const b = button('', label, action, kind === 'check' ? 'save-task' : 'cancel-task');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', kind === 'check' ? 'M3 10l4 4L17 4' : 'M4 4l12 12M16 4L4 16');
  svg.append(path); b.append(svg); return b;
}
function hideToast(immediate = false) {
  clearTimeout(undoTimer); clearTimeout(hideToastTimer);
  undoRecord = null;
  if (immediate || reducedMotion.matches) {
    $('toast').hidden = true; $('toast').classList.remove('leaving');
  } else {
    $('toast').classList.add('leaving');
    hideToastTimer = setTimeout(() => { $('toast').hidden = true; }, 150);
  }
}
function showToast(text, undo, generation) {
  if (generation !== notificationGeneration) return;
  hideToast(true);
  $('toastText').textContent = text;
  $('toast').classList.remove('leaving'); $('toast').hidden = false;
  undoRecord = {undo, expires: Date.now() + 2500};
  undoTimer = setTimeout(() => hideToast(), 2500);
}
async function deleteTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task || operationBusy) return;
  const snapshot = {...task}, generation = ++notificationGeneration;
  hideToast(true); clearTimeout(draftTimer);
  removeTask(state, id); render();
  const finish = async () => {
    await persist();
    showToast('Задача удалена', () => restoreTask(state, snapshot), generation);
    retryOperation = null;
  };
  try { await finish(); } catch (error) { retryOperation = finish; message(error); }
}
function requestDelete(id) {
  if (operationBusy || !state.tasks.some(t => t.id === id)) return;
  if (!state.settings.confirmDelete) { void deleteTask(id); return; }
  pendingDelete = id; $('dontAsk').checked = false;
  $('deleteDialog').showModal(); $('no').focus();
}
function afterMutation() { render(); persist().catch(message); }
function commitTask(next = false) {
  saveDraft(state, crypto.randomUUID());
  clearTimeout(draftTimer);
  if (next) startDraft(state);
  afterMutation();
}

function makeEditor({text, label, onInput, onSave, onCancel, importRow = false}) {
  const area = document.createElement('div'); area.className = 'editor-area';
  const controls = document.createElement('div'); controls.className = 'editor';
  const field = document.createElement('div'); field.className = 'input-wrap';
  const input = document.createElement('textarea'); input.className = 'draft-input';
  input.rows = 1; input.value = text; input.setAttribute('aria-label', label);
  const counter = document.createElement('span'); counter.className = 'counter';
  const error = document.createElement('p'); error.className = 'error-text';
  error.setAttribute('role', 'alert');
  let submitted = false;
  const submit = (next = false, refocus = true) => {
    if (submitted || !area.isConnected) return;
    try {
      validateText(input.value); submitted = true;
      onSave(input.value, next);
    } catch (e) { submitted = false; error.textContent = e.message; if (refocus) input.focus(); }
  };
  const yes = glyphButton('check', importRow ? 'Сохранить правку' : 'Сохранить задачу', () => submit());
  const no = glyphButton('cross', importRow ? 'Отменить правку' : 'Удалить строку', onCancel);
  // Keep editor controls from blurring the field before their click is handled.
  for (const control of [yes, no]) control.onpointerdown = e => e.preventDefault();
  if (!importRow) {
    const autosave = () => {
      if (!submitted && area.isConnected && input.value.trim() && !operationBusy) submit(false, false);
    };
    saveActiveEditor = autosave;
    input.onblur = () => queueMicrotask(() => {
      if (controls.contains(document.activeElement)) return;
      if (pointerInProgress) pendingEditorBlur = autosave;
      else autosave();
    });
  }
  function resize() {
    field.classList.remove('multiline'); input.style.height = '34px';
    if (input.scrollHeight > 34) field.classList.add('multiline');
    input.style.height = 'auto';
    input.style.height = Math.max(34, input.scrollHeight + 2) + 'px';
  }
  function update(edited = false) {
    const n = countText(input.value), invalid = n > 80;
    counter.textContent = n + ' / 80';
    yes.disabled = invalid || !input.value.trim();
    area.classList.toggle('invalid', invalid);
    error.textContent = invalid ? 'Максимум 80 символов' : '';
    if (edited) onInput(input.value);
    resize();
  }
  input.oninput = () => update(true);
  input.onkeydown = e => {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); if (!yes.disabled) submit(); }
    if (e.key === 'Tab' && !e.shiftKey && !importRow) {
      e.preventDefault(); if (!yes.disabled) submit(true);
    }
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (importRow) onCancel();
      else { state.draft = null; clearTimeout(draftTimer); afterMutation(); }
    }
  };
  field.append(input, counter); controls.append(field, yes, no); area.append(controls, error);
  requestAnimationFrame(() => {
    if (!area.isConnected) return;
    update();
    if (document.activeElement !== input) {
      input.focus(); input.setSelectionRange(input.value.length, input.value.length);
      area.scrollIntoView({block:'nearest'});
    }
  });
  return area;
}
function render() {
  saveActiveEditor = null;
  const host = $('tasks'), scroll = host.scrollTop;
  host.replaceChildren();
  for (const task of rows(state)) {
    const row = document.createElement('div');
    row.className = 'row' + (task.done ? ' done' : ''); row.dataset.id = task.id;
    row.oncontextmenu = e => {
      if (e.target.closest('textarea')) return;
      e.preventDefault(); requestDelete(task.id);
    };
    if (state.draft?.id === task.id) {
      row.append(makeEditor({
        text:state.draft.text, label:'Изменить задачу',
        onInput:text => { state.draft.text = text; scheduleDraft(); },
        onSave:(_text, next) => commitTask(next),
        onCancel:() => requestDelete(task.id),
      }));
    } else {
      const check = button('', task.done ? 'Вернуть задачу в работу' : 'Отметить выполненной', () => {
        if (operationBusy) return;
        saveActiveEditor?.();
        toggleTask(state, task.id, Date.now(), boot); afterMutation();
      }, 'task-toggle');
      check.setAttribute('role', 'checkbox'); check.setAttribute('aria-checked', String(task.done));
      if (task.done) { const img = document.createElement('img'); img.src='assets/mini.svg'; img.alt=''; check.append(img); }
      const text = document.createElement('span');
      text.className='task-text'; text.textContent=task.text; text.tabIndex=0;
      text.setAttribute('aria-label', 'Изменить: ' + task.text);
      const edit = () => {
        if (state.draft) { host.querySelector('textarea')?.focus(); return; }
        startDraft(state, task.id); render(); persist().catch(message);
      };
      text.ondblclick=edit; text.onkeydown=e=>{if(e.key==='Enter'||e.key==='F2'){e.preventDefault();edit();}};
      row.append(check, text);
    }
    host.append(row);
  }
  if (state.draft?.id === null) {
    const row = document.createElement('div'); row.className = 'row';
    row.append(makeEditor({
      text:state.draft.text, label:'Новая задача',
      onInput:text => { state.draft.text=text; scheduleDraft(); },
      onSave:(_text, next) => commitTask(next),
      onCancel:() => { state.draft=null;clearTimeout(draftTimer);afterMutation(); },
    })); host.append(row);
  }
  if (!state.tasks.length && !state.draft) {
    const empty=document.createElement('div'); empty.className='empty-list';
    const img=document.createElement('img');img.src='assets/mini.svg';img.alt='';
    const title=document.createElement('h2');title.textContent='Пока нет задач';
    const note=document.createElement('p');note.className='note';note.textContent='Добавьте первое дело';
    empty.append(img,title,note);host.append(empty);
  }
  host.scrollTop=scroll;
  const done=state.tasks.filter(t=>t.done).length, percent=state.tasks.length?done/state.tasks.length*100:0;
  $('count').textContent=done+' из '+state.tasks.length;
  $('progressFill').style.width=percent+'%';$('progress').setAttribute('aria-valuenow',String(Math.round(percent)));
  $('add').disabled=!!state.draft||operationBusy;
  applyStyle();
}
function applyStyle() {
  const c=state.settings.color;
  document.documentElement.style.setProperty('--tint',[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)).join(','));
  document.documentElement.style.setProperty('--surface',String(1-state.settings.transparency/100));
  for(const b of $('swatches').children)b.setAttribute('aria-pressed',String(b.dataset.color.toLowerCase()===c.toLowerCase()));
}
async function updateIcon() {
  try {
    iconUrl=state.settings.icon
      ? native?await invoke('read_icon',{name:state.settings.icon,reduceMotion:reducedMotion.matches}):iconUrl
      : 'assets/duck.svg';
    $('compactImage').src=iconUrl;$('previewIcon').src=iconUrl;
  } catch(error) { message(error);$('compactImage').src='assets/duck.svg';$('previewIcon').src='assets/duck.svg'; }
}
async function rememberGeometry() {
  if(!native||geometryBusy||!ready)return;
  const p=await win.outerPosition(),size=await win.innerSize(),scale=await win.scaleFactor();
  if(geometryBusy)return;
  const geometry=state.settings.geometry, mode=state.settings.mode;
  geometry[mode]={x:p.x,y:p.y,width:size.width/scale,height:size.height/scale};
  if(mode==='full'){
    geometry.compact={x:p.x+size.width-100*scale,y:p.y,width:100,height:100};
  }else{
    const full=geometry.full??{width:320,height:470};
    geometry.full={...full,x:p.x+size.width-full.width*scale,y:p.y};
  }
  persist().catch(message);
}
async function monitorFor(rect) {
  const monitors=await tauri.window.availableMonitors();
  return monitors.find(m=>rect.x<m.workArea.position.x+m.workArea.size.width&&rect.x+rect.width>m.workArea.position.x&&rect.y<m.workArea.position.y+m.workArea.size.height&&rect.y+rect.height>m.workArea.position.y)
    ?? await tauri.window.primaryMonitor() ?? monitors[0];
}
async function showView(next) {
  if(operationBusy)return;
  if(next!=='full'&&view==='full')await rememberGeometry();
  view=next;$('previewMenu').hidden=true;
  for(const id of ['full','settings','importView'])$(id).hidden=id!==next;
  $('importButton').setAttribute('aria-expanded',String(next==='importView'));
}
function canLeaveEditor() {
  saveActiveEditor?.();
  if(!state.draft)return true;
  message('Сначала сохраните или отмените изменение задачи.');
  $('tasks').querySelector('textarea')?.focus();return false;
}
async function openImports() {
  if(operationBusy||geometryBusy||!canLeaveEditor())return;
  if(state.settings.mode==='compact')await setMode('full');
  clearMessage();importDraft=null;importEditing=null;renderImportHome();await showView('importView');
}
function renderImportHome() {
  $('importRows').replaceChildren();
  $('importHome').hidden=false;$('importPreview').hidden=true;$('importEmpty').hidden=true;
  const host=$('savedImports');host.replaceChildren();
  for(const entry of state.imports) {
    const b=button('',entry.name,()=>runImport(next=>repeatImport(next,entry.id)),'saved-import');
    const info=document.createElement('span'),name=document.createElement('strong'),count=document.createElement('small'),arrow=document.createElement('span');
    name.textContent=entry.name;count.textContent=entry.tasks.length+' задач';arrow.textContent='→';arrow.className='arrow';arrow.setAttribute('aria-hidden','true');
    info.append(name,count);b.append(info,arrow);host.append(b);
  }
  if(!state.imports.length){const p=document.createElement('p');p.className='empty-imports';p.textContent='Пока нет сохранённых импортов';host.append(p);}
}
async function chooseTxt() {
  if(operationBusy)return;
  clearMessage();
  if(!native){$('txtInput').value='';$('txtInput').click();return;}
  operationBusy=true;$('chooseTxt').disabled=true;$('chooseAnotherTxt').disabled=true;
  try{const file=await invoke('choose_txt');if(file)await loadTxt(file);}
  catch(error){message(error);}
  finally{operationBusy=false;$('chooseTxt').disabled=false;$('chooseAnotherTxt').disabled=false;}
}
async function loadTxt(file) {
  if(!/\.txt$/i.test(file.name))throw Error('Поддерживаются только файлы .txt');
  const records=parseTxt(file.text);importEditing=null;retryOperation=null;
  importDraft={filename:file.name,name:suggestedImportName(state,file.name),records};
  if(!records.length){
    $('importHome').hidden=true;$('importPreview').hidden=true;$('importEmpty').hidden=false;
    $('emptyName').textContent=file.name;return;
  }
  $('txtName').textContent=file.name;$('importName').value=importDraft.name;
  $('importHome').hidden=true;$('importPreview').hidden=false;$('importEmpty').hidden=true;
  renderImportRows();
}
let dropViewPromise = null;
function revealDropView() {
  if(operationBusy)return Promise.resolve(false);
  if(dropViewPromise)return dropViewPromise;
  dropViewPromise=(async()=>{
    await geometryDone;
    if(view!=='importView'||state.settings.mode==='compact')await openImports();
    return view==='importView'&&state.settings.mode==='full';
  })().finally(()=>{dropViewPromise=null;});
  return dropViewPromise;
}
async function acceptDroppedFile(file) {
  if(operationBusy)return;
  try {
    if(!await revealDropView())return;
    clearMessage();await loadTxt(file);
  } catch(error) { message(error); }
}
document.addEventListener('dragover',e=>{
  if(!e.dataTransfer?.types.includes('Files'))return;
  e.preventDefault();e.dataTransfer.dropEffect=operationBusy?'none':'copy';
  revealDropView().catch(message);
});
document.addEventListener('drop',async e=>{
  if(!e.dataTransfer?.files.length)return;
  e.preventDefault();
  if(operationBusy)return;
  try {
    if(e.dataTransfer.files.length!==1)throw Error('Перетащите один файл TXT');
    const file=e.dataTransfer.files[0];
    if(file.size>1024*1024)throw Error('Максимальный размер TXT — 1 МБ');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
    await acceptDroppedFile({name:file.name,text});
  }catch(error){message(error instanceof TypeError?'Выберите текстовый файл в кодировке UTF-8':error);}
});
function updateImportValidity() {
  if(!importDraft)return;
  const records=importDraft.records,valid=records.filter(r=>r.valid).length,skipped=records.length-valid;
  let error='';
  try{validateImportName(state,$('importName').value);}catch(e){error=e.message;}
  $('importName').setAttribute('aria-invalid',String(!!error));
  $('importNameError').textContent=error||'Сохранится для повторного добавления';
  $('importNameError').style.color=error?'var(--danger)':'';
  $('importSummary').textContent=valid+' задачи готовы'+(skipped?' · '+skipped+' длиннее 80 символов':'');
  $('importSkip').textContent=skipped?'Длинные строки будут пропущены':valid?'Все строки готовы к импорту':'В файле нет подходящих задач';
  $('commitImport').disabled=!!error||!valid||importEditing!==null||operationBusy;
}
function renderImportRows() {
  const host=$('importRows'),scroll=host.scrollTop;host.replaceChildren();
  importDraft.records.forEach((record,index)=>{
    const row=document.createElement('div');row.className='row'+(!record.valid?' invalid-import':'');
    const box=document.createElement('span');box.className='import-task-box';box.setAttribute('aria-hidden','true');row.append(box);
    if(importEditing?.index===index){
      row.classList.add('import-editing');
      row.append(makeEditor({
        text:importEditing.text,label:'Исправить строку импорта',importRow:true,
        onInput:text=>{importEditing.text=text;},
        onSave:text=>{reviseImportRow(importDraft.records,index,text);importEditing=null;renderImportRows();},
        onCancel:()=>{importEditing=null;renderImportRows();},
      }));
    }else{
      const body=document.createElement('div');body.className='import-row-body';
      const text=document.createElement('span');text.className='task-text';text.textContent=record.text;body.append(text);
      if(!record.valid){
        const note=document.createElement('p');note.className='error-text';note.textContent=countText(record.text)+' / 80 · сократите текст';
        body.append(note,button('Изменить в строке','Изменить строку '+record.line,()=>{if(importEditing!==null){host.querySelector('textarea')?.focus();return;}importEditing={index,text:record.text};renderImportRows();},'edit-import'));
      }
      row.append(body);
    }
    host.append(row);
  });
  host.scrollTop=scroll;updateImportValidity();
}
async function runImport(produce) {
  if(operationBusy)return;
  operationBusy=true;clearTimeout(draftTimer);clearMessage();
  const generation=++notificationGeneration;hideToast(true);
  for(const b of $('importView').querySelectorAll('button,input'))b.disabled=true;
  operationPromise=(async()=>{
    try {
      const next=validateDocument(state),added=produce(next);
      await save(next);
      state=next;retryOperation=null;importDraft=null;importEditing=null;$('importRows').replaceChildren();
      operationBusy=false;render();await showView('full');
      showToast('Добавлено '+added.count+' задач',()=>removeBatch(state,added.batchId),generation);
    }catch(error){
      retryOperation=()=>runImport(produce);message(error);
    }finally{
      operationBusy=false;operationPromise=null;
      for(const b of $('importView').querySelectorAll('button,input'))b.disabled=false;
      if(importDraft)updateImportValidity();
    }
  })();
  return operationPromise;
}
async function fadeWindow(from,to) {
 const app=$('app');
 const animation=app.animate([{opacity:from},{opacity:to}],{duration:120,easing:'ease-in-out',fill:'forwards'});
 try{await animation.finished;app.style.opacity=String(to);}finally{animation.cancel();}
}
async function setMode(mode) {
  if(geometryBusy||operationBusy)return;
  saveActiveEditor?.();
  if(ready&&state.settings.mode===mode)return;
  if(mode==='compact'&&view!=='full')await showView('full');
  if(native&&ready)await rememberGeometry();
  const from=state.settings.mode,animate=ready&&from!==mode&&!reducedMotion.matches;
  geometryBusy=true;
  let finishGeometry;
  geometryDone=new Promise(resolve=>{finishGeometry=resolve;});
  const app=$('app');
  try {
    if(animate){app.classList.add('fading');await fadeWindow(1,0);}
    if(native){
      const p=await win.outerPosition(),size=await win.innerSize();
      const old=state.settings.geometry[mode];
      const collapsing=mode==='compact'&&from==='full'&&ready;
      const expanding=mode==='full'&&from==='compact'&&ready;
      const probe=expanding?{x:p.x,y:p.y,width:1,height:1}:!collapsing&&old?{x:old.x,y:old.y,width:1,height:1}
        :collapsing?{x:p.x+size.width-1,y:p.y,width:1,height:1}:{...p,...size};
      const monitor=await monitorFor(probe);
      if(monitor){
        const scale=monitor.scaleFactor,area=monitor.workArea;
        let target;
        if(mode==='compact'&&from==='full'&&ready){
          target=compactTarget({...p,...size},scale,{x:area.position.x,y:area.position.y,...area.size});
        }else{
          const saved=expanding?{x:(p.x+size.width)/scale-(old?.width??320),y:p.y/scale,width:old?.width??320,height:old?.height??470}
            :old?{x:old.x/scale,y:old.y/scale,width:old.width,height:old.height}:null;
          const logical=fitGeometry(saved,[{x:area.position.x/scale,y:area.position.y/scale,width:area.size.width/scale,height:area.size.height/scale}],mode);
          target={x:Math.round(logical.x*scale),y:Math.round(logical.y*scale),width:Math.round(logical.width*scale),height:Math.round(logical.height*scale)};
        }
        await win.setMinSize(null);await win.setMaxSize(null);
        await invoke('set_material',{compact:mode==='compact'});
        await invoke('transition_window',{x:target.x,y:target.y,width:target.width,height:target.height});
        await invoke('set_material',{compact:mode==='compact'});
        if(mode==='full'){await win.setMinSize(new tauri.dpi.LogicalSize(Math.min(320,target.width/scale),Math.min(320,target.height/scale)));await win.setMaxSize(new tauri.dpi.LogicalSize(area.size.width/scale,area.size.height/scale));}
        else {await win.setMinSize(new tauri.dpi.LogicalSize(100,100));await win.setMaxSize(new tauri.dpi.LogicalSize(100,100));}
      }
    }
    state.settings.mode=mode;view='full';
    const compact=mode==='compact';
    app.classList.toggle('compact-mode',compact);
    $('compact').hidden=!compact;$('header').hidden=compact;$('full').hidden=compact;
    $('settings').hidden=true;$('importView').hidden=true;$('importButton').setAttribute('aria-expanded','false');
    if(compact){$('message').hidden=true;hideToast(true);}
    await updateIcon();
    if(animate){
      // Let WebView lay out and present the new geometry while fully transparent.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await fadeWindow(0,1);
    }
    if(ready)await persist();
  }catch(error){message(error);}
  finally{geometryBusy=false;app.classList.remove('fading');app.style.removeProperty('opacity');finishGeometry();}
}
async function settings() {
  if(operationBusy||geometryBusy)return;
  if(state.settings.mode==='compact')await setMode('full');
  if(!canLeaveEditor())return;
  for(const name of ['topmost','showDone','confirmDelete'])$(name).checked=state.settings[name];
  $('color').value=state.settings.color;$('transparency').value=state.settings.transparency;$('opacityLabel').value=state.settings.transparency+'%';
  if(native){try{$('autostart').checked=await invoke('autostart_enabled');}catch(e){message(e);}}
  await showView('settings');
}
async function hide() {
  if(native)await win.hide();else message('В приложении Windows окно скроется в трей.');
}
async function exit() {
  if(native)await invoke('quit_app');else message('Данные сохранены. Окно браузера можно закрыть.');
}
async function quit() {
  if(operationPromise)await operationPromise;
  try{clearTimeout(draftTimer);await persist();await exit();}catch{$('exitDialog').showModal();}
}
async function action(name) {
  $('previewMenu').hidden=true;
  if(operationBusy&&name!=='quit'&&name!=='hide')return;
  if(name==='show'){await setMode('full');await showView('full');if(native){await win.show();await win.setFocus();}}
  if(name==='compact')await setMode('compact');
  if(name==='settings'){await settings();if(native){await win.show();await win.setFocus();}}
  if(name==='topmost'){
    const value=!state.settings.topmost;
    if(native)await invoke('set_topmost',{enabled:value});
    state.settings.topmost=value;$('topmost').checked=value;await persist();
  }
  if(name==='hide')await hide();if(name==='quit')await quit();
}
function openMenu(e) {e.preventDefault();if(native)invoke('popup_menu').catch(message);else $('previewMenu').hidden=!$('previewMenu').hidden;}
$('header').oncontextmenu=openMenu;
$('header').onpointerdown=e=>{
  if(e.button!==0||e.target.closest('button')||geometryBusy||operationBusy)return;
  saveActiveEditor?.();
  if(native)win.startDragging().catch(message);
};
$('compact').oncontextmenu=openMenu;
let pointer=null,dragged=false;
$('compact').onpointerdown=e=>{
  if(e.button!==0)return;pointer={x:e.clientX,y:e.clientY};dragged=false;
  $('compact').setPointerCapture(e.pointerId);
};
$('compact').onpointermove=e=>{
  if(!pointer||dragged||Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)<5)return;
  dragged=true;pointer=null;$('compact').releasePointerCapture(e.pointerId);
  if(native)win.startDragging().catch(message);
};
$('compact').onpointercancel=()=>{pointer=null;};
$('compact').onclick=()=>{if(!dragged)void setMode('full');pointer=null;};
$('add').onclick=()=>{if(operationBusy)return;startDraft(state);render();persist().catch(message);};
$('yes').onclick=()=>{const id=pendingDelete;$('deleteDialog').close();pendingDelete=null;if(id)void deleteTask(id);};
$('no').onclick=()=>{$('deleteDialog').close();pendingDelete=null;};
$('deleteDialog').addEventListener('cancel',()=>{pendingDelete=null;});
$('dontAsk').onchange=e=>{state.settings.confirmDelete=!e.target.checked;persist().catch(message);};
$('undo').onclick=async()=>{
  const record=undoRecord;if(!record||Date.now()>record.expires){hideToast(true);return;}
  hideToast(true);retryOperation=null;record.undo();render();
  try{await persist();}catch(error){message(error);}
};
$('settingsButton').onclick=()=>{if(view==='settings')showView('full').catch(message);else settings().catch(message);};
$('importButton').onclick=()=>{if(view==='importView')showView('full').catch(message);else openImports().catch(message);};
$('back').onclick=()=>showView('full').catch(message);
$('collapse').onclick=()=>setMode('compact');
$('hide').onclick=()=>hide().catch(message);
$('dismissMessage').onclick=clearMessage;
$('retry').onclick=()=>Promise.resolve(retryOperation?retryOperation():persist()).catch(message);
$('chooseTxt').onclick=chooseTxt;$('chooseAnotherTxt').onclick=chooseTxt;
$('txtInput').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    if(file.size>1024*1024)throw Error('Максимальный размер TXT — 1 МБ');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
    await loadTxt({name:file.name,text});
  }catch(error){message(error instanceof TypeError?'Выберите текстовый файл в кодировке UTF-8':error);}
};
$('importName').oninput=()=>{if(importDraft){importDraft.name=$('importName').value;updateImportValidity();}};
$('cancelImport').onclick=()=>{if(operationBusy)return;importDraft=null;importEditing=null;retryOperation=null;renderImportHome();};
$('commitImport').onclick=()=>{
  if(!importDraft||importEditing!==null||$('commitImport').disabled)return;
  const records=structuredClone(importDraft.records),name=$('importName').value;
  void runImport(next=>saveImport(next,name,records));
};
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{
  for(const tab of document.querySelectorAll('[data-tab]'))tab.setAttribute('aria-pressed',String(tab===b));
  for(const pane of document.querySelectorAll('[data-pane]'))pane.hidden=pane.dataset.pane!==b.dataset.tab;
};
for(const name of ['topmost','showDone','confirmDelete'])$(name).onchange=async e=>{
  const value=e.target.checked;
  try{if(name==='topmost'&&native)await invoke('set_topmost',{enabled:value});state.settings[name]=value;render();await persist();}
  catch(error){e.target.checked=state.settings[name];message(error);}
};
$('autostart').onchange=async e=>{
  if(!native){e.target.checked=false;message('Автозапуск доступен в приложении Windows.');return;}
  try{await invoke('set_autostart',{enabled:e.target.checked});}catch(error){message(error);}
  try{e.target.checked=await invoke('autostart_enabled');}catch(error){message(error);}
};
for(const color of ['#DCD9EF','#D7E6EC','#CFE7DF','#F0E3D5','#E0E4E9']){
  const b=button('',color,()=>{state.settings.color=color;$('color').value=color;applyStyle();scheduleDraft();});
  b.style.background=color;b.dataset.color=color;b.setAttribute('aria-pressed','false');$('swatches').append(b);
}
$('customColor').onclick=()=>$('color').click();
$('color').oninput=e=>{state.settings.color=e.target.value;applyStyle();scheduleDraft();};
$('transparency').oninput=e=>{state.settings.transparency=Number(e.target.value);$('opacityLabel').value=e.target.value+'%';applyStyle();scheduleDraft();};
$('chooseImage').onclick=async()=>{
  if(!native){message('Выбор изображения доступен в приложении Windows.');return;}
  try{const name=await invoke('choose_image');if(name){state.settings.icon=name;await updateIcon();await persist();}}
  catch{$('imageDialog').showModal();}
};
$('imageOk').onclick=()=>$('imageDialog').close();
$('resetImage').onclick=()=>{state.settings.icon=null;updateIcon();persist().catch(message);};
$('exitCancel').onclick=()=>$('exitDialog').close();
$('exitRetry').onclick=async()=>{try{await persist();$('exitDialog').close();await exit();}catch{}};
$('exitAnyway').onclick=exit;
for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>action(b.dataset.action).catch(message);
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape'||document.querySelector('dialog[open]')||e.target.closest('textarea'))return;
  $('previewMenu').hidden=true;
  if(view!=='full'&&!operationBusy){e.preventDefault();showView('full').catch(message);}
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#previewMenu')&&!e.target.closest('#header')&&!e.target.closest('#compact'))$('previewMenu').hidden=true;});
async function recoverStart(value) {
  try{state=validateDocument(value);$('recovery').close();await bootAndRender();}
  catch(error){$('recoveryError').textContent=String(error);}
}
$('recover').onclick=async()=>{if(native)try{const value=await invoke('recover_state');if(value)await recoverStart(value);}catch(error){$('recoveryError').textContent=String(error);}};
$('startEmpty').onclick=async()=>{
  if(!confirm('Сохранить повреждённый файл отдельно и начать пустой список?'))return;
  try{if(native)await invoke('archive_corrupt');else localStorage.removeItem('checkoverlay-preview');await recoverStart(fresh());}
  catch(error){$('recoveryError').textContent=String(error);}
};
async function bootAndRender() {
  if(native)try{boot=await invoke('boot_id');}catch(error){message('Не удалось определить загрузку Windows: '+error);}
  cleanup(state,Date.now(),boot);render();await setMode(state.settings.mode);
  if(native)await invoke('set_topmost',{enabled:state.settings.topmost});
  ready=true;
  try{await persist();}catch(error){message(error);}
  await document.fonts.ready;
  if(native)await win.show();
  if(native){
    let timer;
    const remember=()=>{clearTimeout(timer);timer=setTimeout(()=>rememberGeometry().catch(message),250);};
    await win.onMoved(remember);await win.onResized(remember);
  }
  setInterval(()=>{if(!operationBusy&&cleanup(state,Date.now(),boot))afterMutation();},1000);
  window.addEventListener('focus',()=>{
    if(undoRecord&&Date.now()>undoRecord.expires)hideToast(true);
    if(!operationBusy&&cleanup(state,Date.now(),boot))afterMutation();
  });
  window.addEventListener('blur',()=>saveActiveEditor?.());
}
async function init() {
  if(native)await tauri.event.listen('native-error',e=>message(e.payload));
  if(native)await tauri.event.listen('native-file-drag',async e=>{
    if(!ready||operationBusy)return;
    if(e.payload.type==='enter')await revealDropView().catch(message);
    if(e.payload.type==='drop')await acceptDroppedFile(e.payload.file);
  });
  if(native)await tauri.event.listen('app-action',async e=>{
    try{
      if(!ready){if(e.payload==='quit'){await exit();return;}if(e.payload==='hide'){await win.hide();return;}await win.show();await win.setFocus();return;}
      await action(e.payload);
    }catch(error){message(error);}
  });
  else{document.body.classList.add('browser-preview');$('previewNotice').hidden=false;}
  try{
    const value=native?await invoke('load_state'):JSON.parse(localStorage.getItem('checkoverlay-preview')??'null');
    state=value?validateDocument(value):fresh();
  }catch(error){$('recoveryError').textContent=String(error);$('recovery').showModal();if(native)await win.show();return;}
  await bootAndRender();
}
reducedMotion.addEventListener('change',()=>updateIcon());
init().catch(message);
