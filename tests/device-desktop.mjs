import assert from 'node:assert/strict';
import { mkdir,mkdtemp,readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { atomicTemplate } from '../src/atomic.js';
import { createHash } from 'node:crypto';

const packaged=process.argv.includes('--packaged'),output=path.resolve('artifacts/device-ui');
await mkdir(output,{recursive:true});const profile=await mkdtemp(path.join(output,'profile-'));
let app,page;const errors=[],requests=[];
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('virtualfab.project.v1')));
async function launch(){
  app=await electron.launch({executablePath:packaged?path.resolve('dist/VirtualFab-win32-x64/VirtualFab.exe'):undefined,args:[...(packaged?[]:['.']),`--user-data-dir=${profile}`],cwd:process.cwd(),timeout:30000});
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!/^(virtualfab:|data:|blob:)/.test(r.url()))requests.push(r.url());});await page.locator('#three-view canvas').waitFor();await page.setViewportSize({width:1440,height:1000});
}
async function newBenchmark(pin=false){
  await page.locator('[data-view="bands"]').click();await page.locator('[data-band-mode="equilibrium"]').click();await page.locator('#equilibrium-source').selectOption('device');
  await page.locator('#device-model-settings').evaluate(e=>e.open=true);
  await page.locator(pin?'#device-new-pin':'#device-new-pn').click();await page.locator('#confirm-ok').click();await page.locator('#device-preview').filter({hasText:'适用性检查通过'}).waitFor();
}
async function solve(){await page.locator('#device-solve').click();await page.locator('#device-status').filter({hasText:'已完成'}).waitFor({timeout:45000});await page.locator('#equilibrium-status').filter({hasText:'已收敛'}).waitFor();}
async function readEventually(file){for(let i=0;i<100;i++){try{return await readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;await delay(50);}}throw Error('File not exported: '+file);}
try{
  await launch();await newBenchmark();assert.equal((await saved()).devicePhysics.regions.length,2);assert.match(await page.locator('#device-preview').innerText(),/不是真实工艺电极/);
  const first=page.locator('[data-region]').first();await first.locator('..').locator('summary').click();
  await first.locator('[name="donor"]').fill('');await first.locator('button[type="submit"]').click();
  assert.equal((await saved()).devicePhysics.regions[0].donor.value,null);assert.ok(await page.locator('#device-solve').isDisabled());assert.match(await page.locator('#device-preview').innerText(),/未知不等于零/);
  await first.locator('[name="donor"]').fill('0');await first.locator('button[type="submit"]').click();assert.ok(await page.locator('#device-solve').isEnabled());
  await first.locator('..').locator('summary').click();await page.locator('#device-regions-settings summary').first().click();await page.locator('#device-path-settings summary').click();
  const exclusive=await page.evaluate(async dft=>{
    const p=JSON.parse(localStorage.getItem('virtualfab.project.v1')),job=await window.virtualFabPhysics.start(p,0);let message='';
    try{await window.virtualFabDft.start(dft);}catch(e){message=e.message;}await window.virtualFabPhysics.cancel(job.id);return message;
  },atomicTemplate());assert.match(exclusive,/平衡计算正在运行/);
  await solve();assert.match(await page.locator('#device-result-binding').innerText(),/当前输入/);assert.match(await page.locator('#equilibrium-summary').textContent(),/Poisson/);
  await page.locator('#equilibrium-summary details').filter({hasText:'耗尽区操作定义'}).locator('summary').click();
  assert.match(await page.locator('#equilibrium-summary').innerText(),/0\.5/);await page.screenshot({path:path.join(output,'pn-mapped.png'),fullPage:true});
  const jsonFile=path.join(profile,'硅器件结果.json');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},jsonFile);await page.locator('#export-equilibrium-meta').click();
  const exported=JSON.parse(await readEventually(jsonFile));assert.equal(exported.mapping.config.acceptorCm3,1e16);assert.ok(exported.accuracyPassed);assert.equal(exported.validation.experiment.state,'unchecked');assert.ok(exported.task.inputHash);
  const csvFile=path.join(profile,'硅平衡节点.csv');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},csvFile);await page.locator('#export-equilibrium').click();
  const csv=await readEventually(csvFile);assert.match(csv,/^sUm,axisCoordinateUm,/);const meta=JSON.parse(await readEventually(csvFile+'.metadata.json'));assert.equal(meta.task.inputHash,exported.task.inputHash);assert.equal(meta.csvSha256,createHash('sha256').update(csv).digest('hex'));
  const projectFile=path.join(profile,'硅基准项目.json');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},projectFile);await page.locator('#save-as-project').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已保存'));
  const project=JSON.parse(await readFile(projectFile,'utf8'));assert.equal(project.devicePhysics.jobs.length,1);
  await page.locator('#grid-settings').click();await page.locator('#grid-form [name="resolution"]').fill('32');await page.locator('#grid-form button[type="submit"]').click();
  assert.match(await page.locator('#device-binding').innerText(),/失效/);assert.ok(await page.locator('#device-solve').isDisabled());assert.match(await page.locator('#device-result-binding').innerText(),/历史结果/);assert.match(await page.locator('#equilibrium-status').innerText(),/历史/);
  await page.screenshot({path:path.join(output,'stale-result.png'),fullPage:true});
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},projectFile);await page.locator('#open-project').click();await page.locator('#confirm-ok').click();await page.locator('#device-result-binding').filter({hasText:'当前输入'}).waitFor();
  assert.equal((await saved()).resolution,16);assert.equal((await saved()).devicePhysics.regions[0].donor.value,0);
  await app.close();app=null;await launch();await page.locator('[data-view="bands"]').click();await page.locator('[data-band-mode="equilibrium"]').click();await page.locator('#device-result-binding').filter({hasText:'当前输入'}).waitFor();
  await newBenchmark(true);await solve();assert.match(await page.locator('#equilibrium-status').innerText(),/PIN/);
  await page.locator('#equilibrium-quantity').selectOption('potential');assert.equal(await page.locator('[data-series="potentialV"]').count(),1);await page.screenshot({path:path.join(output,'pin-potential.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('#equilibrium-plot').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));await page.screenshot({path:path.join(output,'mapped-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log(`Mapped physics desktop ${packaged?'packaged':'development'} passed: missing/zero semantics, geometry preview, real PN/PIN, numerical checks, JSON export, save/reopen, restart/history, stale geometry, potential and mobile layout.`);
}finally{await app?.close();}
