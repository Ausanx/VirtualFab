import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const packaged=process.argv.includes('--packaged');
const profile=path.resolve('artifacts/desktop-smoke-profile');
const executablePath=packaged?path.resolve('dist/VirtualFab-win32-x64/VirtualFab.exe'):undefined;
await mkdir(profile,{recursive:true});
await rm(profile,{recursive:true,force:true});
await mkdir(profile,{recursive:true});

async function open() {
  const app=await electron.launch({executablePath,args:[...(packaged?[]:['.']),`--user-data-dir=${profile}`],cwd:process.cwd(),timeout:30000});
  const page=await app.firstWindow();
  await page.locator('#three-view canvas').waitFor({timeout:15000});
  assert.equal(page.url(),'virtualfab://app/');
  assert.match(await page.locator('#simulation-status').innerText(),/几何计算完成/);
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
  return {app,page};
}

let first=await open();
try {
  const {page}=first;
  const type=await page.locator('#workspace-title').evaluate(element=>({size:getComputedStyle(element).fontSize,spacing:getComputedStyle(element).letterSpacing}));
  assert.ok(parseFloat(type.size)>=14&&parseFloat(type.size)<=16);
  assert.ok(['normal','0px'].includes(type.spacing));
  await page.locator('.recipe-card[data-index="5"]').click();
  assert.equal(await page.locator('#mask-target').evaluate(canvas=>{
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    return new Set(Array.from({length:canvas.width*canvas.height},(_,i)=>data[i*4])).size;
  }),2,'packaged exposure preview must render open and covered cells');
  await page.locator('#template').selectOption('backgate');
  await page.locator('#load-template').click();
  await page.locator('#confirm-ok').click();
  await page.locator('#project-name').fill('桌面持久化验收');
  await page.locator('#project-name').press('Tab');
  assert.equal(await page.locator('#save-status').innerText(),'未保存更改');
  const firstPath=path.resolve(`artifacts/desktop-project-${process.pid}.json`);
  const secondPath=path.resolve(`artifacts/desktop-copy-${process.pid}.json`);
  const newPath=path.resolve(`artifacts/desktop-new-${process.pid}.json`);
  await first.app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},firstPath);
  await page.locator('#save-project').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.startsWith('已保存'));
  assert.equal(JSON.parse(await readFile(firstPath,'utf8')).name,'桌面持久化验收');
  await page.locator('#project-name').fill('桌面覆盖保存验收');
  await page.locator('#project-name').press('Tab');
  await first.app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>{throw Error('Save should use the current file');};});
  await page.locator('#save-project').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.startsWith('已保存'));
  assert.equal(JSON.parse(await readFile(firstPath,'utf8')).name,'桌面覆盖保存验收');
  await first.app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},secondPath);
  await page.locator('#save-as-project').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').title.includes('desktop-copy-'));
  assert.equal(JSON.parse(await readFile(secondPath,'utf8')).name,'桌面覆盖保存验收');
  assert.equal(JSON.parse(await readFile(firstPath,'utf8')).name,'桌面覆盖保存验收');
  await page.locator('#project-name').fill('取消另存为');
  await page.locator('#project-name').press('Tab');
  await first.app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});
  await page.locator('#save-as-project').click();
  assert.equal(await page.locator('#save-status').innerText(),'未保存更改');
  assert.equal(JSON.parse(await readFile(secondPath,'utf8')).name,'桌面覆盖保存验收');
  await page.locator('#project-name').fill('桌面覆盖保存验收');
  await page.locator('#project-name').press('Tab');
  const invalidPath=path.resolve(`artifacts/desktop-invalid-${process.pid}.json`);
  await writeFile(invalidPath,'{"version":500}');
  await first.app.evaluate(({dialog},target)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});},invalidPath);
  await page.locator('#open-project').click();
  await page.locator('#toast').filter({hasText:'打开失败'}).waitFor();
  assert.equal(await page.locator('#project-name').inputValue(),'桌面覆盖保存验收');
  await first.app.evaluate(({dialog},target)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});},firstPath);
  await page.locator('#open-project').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').title.includes('desktop-project-'));
  await page.locator('#project-name').fill('替换前先保存');
  await page.locator('#project-name').press('Tab');
  await page.locator('#new-project').click();
  assert.ok(await page.locator('#confirm-save').isVisible());
  await page.locator('#confirm-save').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='尚未保存到文件');
  assert.equal(JSON.parse(await readFile(firstPath,'utf8')).name,'替换前先保存');
  await page.locator('#project-name').fill('桌面新建验收');
  await page.locator('#project-name').press('Tab');
  await first.app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},newPath);
  await page.locator('#save-project').click();
  await page.waitForFunction(()=>document.querySelector('#save-status').title.includes('desktop-new-'));
  assert.equal(JSON.parse(await readFile(newPath,'utf8')).name,'桌面新建验收');
  assert.equal(JSON.parse(await readFile(firstPath,'utf8')).name,'替换前先保存');
  await page.screenshot({path:'artifacts/desktop-app.png'});
} finally {await first.app.close();}

const second=await open();
try {
  assert.equal(await second.page.locator('#project-name').inputValue(),'桌面新建验收');
  assert.equal(await second.page.locator('#template').inputValue(),'backgate');
  assert.ok((await second.page.locator('#results-panel').innerText()).includes('底栅 FET'));
  assert.equal(await second.page.locator('#save-status').innerText(),'未保存更改');
  console.log(`Desktop ${packaged?'packaged':'development'} checks passed: native new/open/save/save as, cancellation, WebGL, and project recovery.`);
} finally {await second.app.close();}
