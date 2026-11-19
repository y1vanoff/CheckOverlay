import {test,expect} from '@playwright/test';
import {fresh} from '../../web/core.js';

async function nativeGeometry(page){
 const seed=fresh();seed.settings.geometry={full:{x:100,y:100,width:320,height:470},compact:{x:1700,y:900,width:100,height:100}};
 await page.addInitScript(seed=>{
  window.calls=[];let position={x:100,y:100},size={width:480,height:705};
  class Size{constructor(width,height){this.width=width;this.height=height;}}
  class Pos{constructor(x,y){this.x=x;this.y=y;}}
  const w={outerPosition:async()=>({...position}),innerSize:async()=>({...size}),scaleFactor:async()=>1.5,onMoved:async()=>()=>{},onResized:async()=>()=>{}};
  for(const name of ['setMinSize','setMaxSize','setResizable','show','hide','setFocus','startDragging'])w[name]=async(...args)=>{window.calls.push({name,args});};
  w.setSize=async v=>{size={width:v.width*1.5,height:v.height*1.5};};w.setPosition=async v=>{position={...v};};
  const m={scaleFactor:1.5,workArea:{position:{x:0,y:0},size:{width:2880,height:1560}}};
  window.__TAURI__={core:{invoke:async(name,args)=>{
   window.calls.push({name,args});if(name==='load_state')return seed;if(name==='boot_id')return 'boot-test';
   if(name==='transition_window'){position={x:args.x,y:args.y};size={width:args.width,height:args.height};}
  }},window:{getCurrentWindow:()=>w,availableMonitors:async()=>[m],primaryMonitor:async()=>m},dpi:{LogicalSize:Size,PhysicalPosition:Pos},event:{listen:async()=>()=>{}}};
 },seed);
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-save-status','saved');
}

test('collapse anchors to the current top-right at 150% and restores full geometry',async({page})=>{
 await nativeGeometry(page);await page.getByRole('button',{name:'Свернуть в иконку',exact:true}).click();await expect(page.locator('#compact')).toBeVisible();
 let target=await page.evaluate(()=>window.calls.filter(x=>x.name==='transition_window').at(-1).args);
 expect(target).toEqual({x:430,y:100,width:150,height:150,animate:true});
 await page.getByRole('button',{name:'Открыть чеклист'}).click();await expect(page.locator('#full')).toBeVisible();
 target=await page.evaluate(()=>window.calls.filter(x=>x.name==='transition_window').at(-1).args);
 expect(target).toMatchObject({x:100,y:100,width:480,height:705});
 await page.locator('#header').click({position:{x:160,y:44}});
 expect(await page.evaluate(()=>window.calls.filter(x=>x.name==='startDragging').length)).toBe(1);
 await page.getByRole('button',{name:'Импорт задач',exact:true}).click();
 expect(await page.evaluate(()=>window.calls.filter(x=>x.name==='startDragging').length)).toBe(1);
});

test('system reduced-motion preference disables the native window animation',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await nativeGeometry(page);await page.getByRole('button',{name:'Свернуть в иконку',exact:true}).click();await expect(page.locator('#compact')).toBeVisible();
 expect(await page.evaluate(()=>window.calls.filter(x=>x.name==='transition_window').at(-1).args.animate)).toBe(false);
});
test('failed startup write still exposes window and retry; compact mode clears material',async({page})=>{
 await page.addInitScript(()=>{window.calls=[];const hit=(name,...args)=>{window.calls.push({name,args});return Promise.resolve();};class Size{constructor(width,height){this.width=width;this.height=height;}}class Pos{constructor(x,y){this.x=x;this.y=y;}}const w={outerPosition:async()=>({x:10,y:10}),innerSize:async()=>({width:380,height:640}),scaleFactor:async()=>1,onMoved:async()=>()=>{},onResized:async()=>()=>{}};for(const name of ['setMinSize','setMaxSize','setResizable','setSize','setPosition','setAlwaysOnTop','show','hide','setFocus','startDragging'])w[name]=(...args)=>hit(name,...args);const m={scaleFactor:1,workArea:{position:{x:0,y:0},size:{width:1920,height:1040}}};window.__TAURI__={core:{invoke:async(name,args)=>{window.calls.push({name,args});if(name==='load_state')return null;if(name==='boot_id')return 'boot-test';if(name==='save_state')throw Error('disk unavailable');}},window:{getCurrentWindow:()=>w,availableMonitors:async()=>[m],primaryMonitor:async()=>m},dpi:{LogicalSize:Size,PhysicalPosition:Pos},event:{listen:async()=>()=>{}}};});
 await page.goto('/');await expect(page.locator('#saveStatus')).toHaveText('Не удалось сохранить');await expect(page.locator('#retry')).toBeVisible();expect(await page.evaluate(()=>window.calls.some(x=>x.name==='show'))).toBe(true);await page.getByRole('button',{name:'Свернуть в иконку',exact:true}).click();await expect(page.locator('#compact')).toBeVisible();expect(await page.evaluate(()=>window.calls.some(x=>x.name==='set_material'&&x.args.compact))).toBe(true);
});
