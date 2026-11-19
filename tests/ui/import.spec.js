import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.goto('/');await page.evaluate(()=>localStorage.clear());await page.reload();});
const snapshot=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('checkoverlay-preview')));
async function open(page){await page.getByRole('button',{name:'Импорт задач',exact:true}).click();await expect(page.locator('#importHome')).toBeVisible();}
async function txt(page,text,name='Список.txt'){await page.locator('#txtInput').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(text)});}
async function commit(page){await page.locator('#commitImport').click();await expect(page.locator('#full')).toBeVisible();await expect(page.locator('#toast')).toBeVisible();}

test('TXT preview, inline repair, saved replay, group undo and durable snapshots',async({page})=>{
 await open(page);await txt(page,'\uFEFFПервая\r\n\r\nВторая\r\n'+'я'.repeat(81));
 await expect(page.locator('#importRows .row')).toHaveCount(3);await expect(page.locator('#importRows [aria-checked=true]')).toHaveCount(0);
 await page.getByRole('button',{name:'Изменить строку 4'}).click();await expect(page.locator('#commitImport')).toBeDisabled();
 await page.getByRole('textbox',{name:'Исправить строку импорта'}).fill('я'.repeat(80));await page.getByRole('button',{name:'Сохранить правку',exact:true}).click();await commit(page);
 await expect(page.locator('#tasks .row')).toHaveCount(3);let s=await snapshot(page);expect(s.imports).toHaveLength(1);expect(s.imports[0].tasks[2]).toHaveLength(80);
 await page.getByRole('checkbox',{name:'Отметить выполненной'}).first().click();await page.reload();await open(page);
 await page.getByRole('button',{name:'Список',exact:true}).click();await expect(page.locator('#tasks .row')).toHaveCount(6);
 await page.locator('#undo').click();await expect(page.locator('#tasks .row')).toHaveCount(3);
 s=await snapshot(page);expect(s.imports).toHaveLength(1);expect(s.tasks.filter(t=>t.done)).toHaveLength(1);await page.reload();expect((await snapshot(page)).imports).toHaveLength(1);
});
test('unique names, cancel, empty files and format errors keep current data intact',async({page})=>{
 await open(page);await txt(page,'Первая');await commit(page);await open(page);await txt(page,'Вторая');
 await expect(page.locator('#importName')).toHaveValue('Список (2)');await page.locator('#importName').fill('  СПИСОК  ');await expect(page.locator('#importNameError')).toContainText('уже есть');await expect(page.locator('#commitImport')).toBeDisabled();
 await page.locator('#cancelImport').click();await txt(page,' \r\n\t','Пустой.txt');await expect(page.locator('#importEmpty')).toBeVisible();
 await txt(page,'- [ ] Строка','tasks.md');await expect(page.locator('#message')).toContainText('только файлы .txt');
 await page.locator('#txtInput').setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from([255,254,255])});await expect(page.locator('#message')).toContainText('UTF-8');
 const s=await snapshot(page);expect(s.imports).toHaveLength(1);expect(s.tasks).toHaveLength(1);
});
test('failed import is atomic and retry creates one snapshot and one batch',async({page})=>{
 await page.evaluate(()=>{window.failImports=true;const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(window.failImports&&k==='checkoverlay-preview'&&JSON.parse(v).imports.length)throw Error('disk unavailable');return set.call(this,k,v);};});
 await open(page);await txt(page,'Первая\nВторая');await page.locator('#commitImport').click();await expect(page.locator('#saveFailure')).toBeVisible();await expect(page.locator('#importPreview')).toBeVisible();expect((await snapshot(page)).imports).toHaveLength(0);
 await page.evaluate(()=>{window.failImports=false;});await page.locator('#retry').click();await expect(page.locator('#toast')).toBeVisible();const s=await snapshot(page);expect(s.imports).toHaveLength(1);expect(s.tasks).toHaveLength(2);
});
test('notification expires after 2.5 seconds and a new operation owns its own undo',async({page})=>{
 await page.clock.install();await open(page);await txt(page,'Первая');await commit(page);await page.clock.fastForward(2700);await expect(page.locator('#toast')).toBeHidden();
 await page.locator('#tasks').getByText('Первая',{exact:true}).click({button:'right'});await page.getByRole('button',{name:'Да',exact:true}).click();await expect(page.locator('#toastText')).toHaveText('Задача удалена');await page.locator('#undo').click();await expect(page.locator('#tasks .row')).toHaveCount(1);
 await page.locator('#tasks').getByText('Первая',{exact:true}).click({button:'right'});await page.getByRole('button',{name:'Да',exact:true}).click();await page.clock.fastForward(2700);await expect(page.locator('#toast')).toBeHidden();expect((await snapshot(page)).tasks).toHaveLength(0);
});
test('approved typography, thin scrollbar, progress and an 80-character editor stay usable',async({page})=>{
 await open(page);await txt(page,Array.from({length:15},(_,i)=>'Задача '+(i+1)).join('\n'));await commit(page);await page.locator('#undo').blur();
 await expect(page.locator('#count')).toHaveText('0 из 15');const geometry=await page.locator('#tasks').evaluate(e=>({font:getComputedStyle(e).fontFamily,bar:getComputedStyle(e,'::-webkit-scrollbar').width,overflow:e.scrollHeight>e.clientHeight}));expect(geometry.font).toContain('Montserrat Alternates');expect(geometry.bar).toBe('4px');expect(geometry.overflow).toBe(true);
 await page.locator('#add').click();await page.getByRole('textbox',{name:'Новая задача'}).fill('я'.repeat(80));const bounds=await page.locator('.editor').evaluate(e=>{const field=e.querySelector('.input-wrap').getBoundingClientRect(),counter=e.querySelector('.counter').getBoundingClientRect(),buttons=[...e.querySelectorAll('button')].map(b=>b.getBoundingClientRect());return {inside:counter.right<=field.right&&counter.bottom<=field.bottom,centers:buttons.every(b=>Math.abs(b.y+b.height/2-field.y-field.height/2)<1)};});expect(bounds.inside).toBe(true);expect(bounds.centers).toBe(true);
});
