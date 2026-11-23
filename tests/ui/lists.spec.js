
import {test,expect} from '@playwright/test';
async function ready(page){await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-save-status','saved');}
async function add(page,text){await page.locator('#add').click();await page.getByRole('textbox',{name:'Новая задача',exact:true}).fill(text);await page.getByRole('button',{name:'Сохранить задачу',exact:true}).click();}
test('lists persist separately; move, undo and import from Big target Today',async({page})=>{
 await ready(page);await add(page,'Daily');await page.getByRole('tab',{name:'Большие',exact:true}).click();await add(page,'Big');
 await expect(page.locator('#tasks')).not.toContainText('Daily');await expect(page.locator('#count')).toHaveText('0 из 1');
 await page.reload();await expect(page.getByRole('tab',{name:'Большие',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'Перенести в На сегодня',exact:true}).click();await expect(page.locator('#toast')).toContainText('Задача перенесена на сегодня');await expect(page.locator('#tasks')).not.toContainText('Big');
 await page.locator('#undo').click();await expect(page.locator('#tasks')).toContainText('Big');
 await page.getByRole('button',{name:'Импорт задач',exact:true}).click();
 await page.locator('#txtInput').setInputFiles({name:'from-big.txt',mimeType:'text/plain',buffer:Buffer.from('Imported')});
 await page.locator('#commitImport').click();await expect(page.getByRole('tab',{name:'На сегодня',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('#tasks')).toContainText('Imported');
 await page.getByRole('tab',{name:'Большие',exact:true}).click();await expect(page.locator('#tasks')).toContainText('Big');await expect(page.locator('#importButton')).toBeVisible();
});
test('links are safe clickable anchors; editing remains plain text',async({page})=>{
 await ready(page);await add(page,'См. https://example.org/a?q=1&b=2.');
 const link=page.locator('#tasks a');await expect(link).toHaveAttribute('href','https://example.org/a?q=1&b=2');
 await expect(page.locator('#tasks')).toContainText('https://example.org/a?q=1&b=2.');
 await page.locator('.task-text').press('F2');await expect(page.getByRole('textbox',{name:'Изменить задачу'})).toHaveValue('См. https://example.org/a?q=1&b=2.');
});
test('focus switch collapses only when enabled; modal dialog prevents collapse',async({page})=>{
 await ready(page);await add(page,'Task');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.locator('#compact')).toBeHidden();
 await page.locator('#settingsButton').click();await page.locator('#collapseOnBlur').check();await page.locator('#back').click();
 await page.locator('.task-text').click({button:'right'});await expect(page.locator('#deleteDialog')).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForTimeout(220);await expect(page.locator('#compact')).toBeHidden();
 await page.locator('#no').click();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.locator('#compact')).toBeVisible();
 await page.locator('#compact').click();await expect(page.locator('#full')).toBeVisible();
});
test('failed transfer write keeps task in Big without a success toast',async({page})=>{
 await ready(page);await page.getByRole('tab',{name:'Большие',exact:true}).click();await add(page,'Keep');
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('disk full');};});await page.getByRole('button',{name:'Перенести в На сегодня',exact:true}).click();
 await expect(page.locator('#message')).toContainText('disk full');await expect(page.locator('#tasks')).toContainText('Keep');await expect(page.locator('#toast')).toBeHidden();
});
