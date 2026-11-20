import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.goto('/');await page.evaluate(()=>localStorage.clear());await page.reload();
});
const input=page=>page.getByRole('textbox',{name:'Новая задача'});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('checkoverlay-preview')));

test('Tab saves exactly once and focuses the next editor; empty and invalid input remain editable',async({page})=>{
  await page.locator('#add').click();await input(page).fill('Первая');await input(page).press('Tab');
  await expect(page.locator('.task-text')).toHaveText(['Первая']);
  await expect(input(page)).toHaveValue('');await expect(input(page)).toBeFocused();
  await input(page).press('Tab');await expect(input(page)).toBeFocused();
  await input(page).fill('Вторая');await input(page).press('Tab');
  await expect(page.locator('.task-text')).toHaveText(['Первая','Вторая']);
  await input(page).fill('я'.repeat(81));await input(page).press('Tab');
  await expect(input(page)).toHaveValue('я'.repeat(81));
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на компьютере');
  expect((await saved(page)).tasks).toHaveLength(2);
});

test('clicking outside the editor and losing OS focus save new and edited tasks',async({page})=>{
  await page.locator('#add').click();await input(page).fill('Новая');
  await page.locator('h1').first().click();await expect(input(page)).toHaveCount(0);
  await page.getByText('Новая',{exact:true}).dblclick();
  const edit=page.getByRole('textbox',{name:'Изменить задачу'});await edit.fill('Исправлена');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(edit).toHaveCount(0);await expect(page.locator('.task-text')).toHaveText('Исправлена');
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на компьютере');
  const state=await saved(page);expect(state.draft).toBe(null);expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0].text).toBe('Исправлена');
});

test('cancel and save clicks retain their intended meaning with autosave',async({page})=>{
  await page.locator('#add').click();await input(page).fill('Отменена');
  await page.getByRole('button',{name:'Удалить строку',exact:true}).click();
  await expect(page.locator('.task-text')).toHaveCount(0);
  await page.locator('#add').click();await input(page).fill('Сохранена');
  await page.getByRole('button',{name:'Сохранить задачу',exact:true}).click();
  await expect(page.locator('.task-text')).toHaveText(['Сохранена']);
});

test('clicking a task checkbox also saves the open editor without losing the click',async({page})=>{
  await page.locator('#add').click();await input(page).fill('Первая');await input(page).press('Enter');
  await page.locator('#add').click();await input(page).fill('Вторая');
  await page.getByRole('checkbox',{name:'Отметить выполненной'}).click();
  await expect(page.locator('.task-text')).toHaveText(['Вторая','Первая']);
  await expect(page.locator('.done .task-text')).toHaveText('Первая');
  await expect(input(page)).toHaveCount(0);
});

test('deletion notification never shifts the empty state or Add button',async({page})=>{
  await page.clock.install();await page.locator('#add').click();await input(page).fill('Последняя');
  await input(page).press('Enter');await page.getByText('Последняя',{exact:true}).click({button:'right'});
  await page.locator('#yes').click();await expect(page.locator('#toast')).toBeVisible();
  const before=await page.locator('.empty-list').boundingBox(),add=await page.locator('#add').boundingBox();
  await page.clock.fastForward(2800);await expect(page.locator('#toast')).toBeHidden();
  expect(await page.locator('.empty-list').boundingBox()).toEqual(before);
  expect(await page.locator('#add').boundingBox()).toEqual(add);
});

test('dropping TXT on settings opens Import with a preview and keeps window bounds',async({page})=>{
  await page.locator('#settingsButton').click();const bounds=await page.locator('#app').boundingBox();
  await page.evaluate(()=>{
    const transfer=new DataTransfer();transfer.items.add(new File(['Одна\nВторая'],'tasks.txt',{type:'text/plain'}));
    document.querySelector('#app').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  });
  await expect(page.locator('#importHome')).toBeVisible();
  await page.evaluate(()=>{
    const transfer=new DataTransfer();transfer.items.add(new File(['Одна\nВторая'],'tasks.txt',{type:'text/plain'}));
    document.querySelector('#app').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  });
  await expect(page.locator('#importPreview')).toBeVisible();await expect(page.locator('#importRows .row')).toHaveCount(2);
  expect(await page.locator('#app').boundingBox()).toEqual(bounds);
});

test('palette is centered and the focused outline stays inside the list viewport',async({page})=>{
  await page.locator('#settingsButton').click();await page.locator('[data-tab=appearance]').click();
  const palette=await page.locator('#swatches').evaluate(e=>{
    const outer=e.getBoundingClientRect(),first=e.firstElementChild.getBoundingClientRect(),last=e.lastElementChild.getBoundingClientRect();
    return Math.abs((first.left+last.right)/2-(outer.left+outer.right)/2);
  });expect(palette).toBeLessThan(1);
  await page.locator('#back').click();await page.locator('#add').click();await expect(input(page)).toBeFocused();
  const ring=await input(page).evaluate(e=>{
    const style=getComputedStyle(e),bounds=e.getBoundingClientRect(),host=document.querySelector('#tasks').getBoundingClientRect();
    return {inset:style.boxShadow.includes('inset'),outline:style.outlineStyle,inside:bounds.top>=host.top&&bounds.left>=host.left&&bounds.right<=host.right};
  });expect(ring).toEqual({inset:true,outline:'none',inside:true});
  await page.screenshot({path:'test-results/0.2.1-editor.png'});
});
