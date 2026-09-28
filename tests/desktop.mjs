import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
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
  await page.locator('#template').selectOption('backgate');
  await page.locator('#load-template').click();
  await page.locator('#confirm-ok').click();
  await page.locator('#project-name').fill('桌面持久化验收');
  await page.locator('#project-name').press('Tab');
  assert.equal(await page.locator('#save-status').innerText(),'已保存到本机');
  const exportedPath=path.resolve(`artifacts/desktop-export-${process.pid}.json`);
  await first.app.evaluate(({session},target)=>{
    session.defaultSession.once('will-download',(_event,item)=>item.setSavePath(target));
  },exportedPath);
  await page.locator('#export-project').click();
  let exported;
  for(let attempt=0;attempt<50&&!exported;attempt++) {
    try {exported=JSON.parse(await readFile(exportedPath,'utf8'));}
    catch {await new Promise(resolve=>setTimeout(resolve,100));}
  }
  assert.ok(exported,'the desktop app must write the exported JSON');
  assert.equal(exported.name,'桌面持久化验收');
  exported.name='桌面导入验收';
  await page.locator('#project-file').setInputFiles({name:'import.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await page.locator('#confirm-ok').click();
  assert.equal(await page.locator('#project-name').inputValue(),'桌面导入验收');
  await page.screenshot({path:'artifacts/desktop-app.png'});
} finally {await first.app.close();}

const second=await open();
try {
  assert.equal(await second.page.locator('#project-name').inputValue(),'桌面导入验收');
  assert.equal(await second.page.locator('#template').inputValue(),'backgate');
  assert.ok((await second.page.locator('#results-panel').innerText()).includes('底栅 FET'));
  console.log(`Desktop ${packaged?'packaged':'development'} checks passed: local protocol, WebGL, typography, JSON import/export and project recovery after restart.`);
} finally {await second.app.close();}
