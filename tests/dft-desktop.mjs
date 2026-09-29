import assert from 'node:assert/strict';
import { mkdir,mkdtemp,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const packaged=process.argv.includes('--packaged'),viewOnly=process.argv.includes('--view-only');
const output=path.resolve('artifacts/dft-ui');await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(output,'中文-'));
const errors=[],requests=[];
let app;
try{
  app=await electron.launch({executablePath:packaged?path.resolve('dist/VirtualFab-win32-x64/VirtualFab.exe'):undefined,args:[...(packaged?[]:['.']),`--user-data-dir=${profile}`],cwd:process.cwd(),timeout:30000});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!/^(virtualfab:|data:|blob:)/.test(r.url()))requests.push(r.url());});
  await page.locator('#three-view canvas').waitFor();await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-view="atomic"]').click();await page.locator('#atomic-scene canvas').waitFor();
  await page.screenshot({path:path.join(output,`atomic-${packaged?'packaged':'dev'}-desktop.png`)});
  const canvasColors=()=>{
    const canvas=document.querySelector('#atomic-scene canvas'),gl=canvas.getContext('webgl2'),buffer=new Uint8Array(4*gl.drawingBufferWidth*gl.drawingBufferHeight);
    gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,buffer);
    return new Set(Array.from({length:buffer.length/4},(_,i)=>`${buffer[i*4]},${buffer[i*4+1]},${buffer[i*4+2]}`)).size;
  };
  assert.ok(await page.evaluate(canvasColors)>100,'atomic scene is blank');
  const canvas=page.locator('#atomic-scene canvas'),box=await canvas.boundingBox();
  const before=await canvas.screenshot();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.6,{steps:10});await page.mouse.up();await delay(150);
  assert.notDeepEqual(await canvas.screenshot(),before,'atomic camera does not respond');
  await page.locator('#atomic-dimensionality').selectOption('2');
  assert.match(await page.locator('#atomic-size').innerText(),/2 原子 · 3D/,'selecting an import dimension cannot change the current crystal');
  await page.locator('#atomic-template').selectOption('MoS2');await page.locator('#atomic-load').click();
  assert.match(await page.locator('#atomic-size').innerText(),/3 原子 · 2D/);
  await page.screenshot({path:path.join(output,'atomic-mos2.png')});
  await page.setViewportSize({width:390,height:844});await page.locator('#atomic-scene').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  assert.ok(await page.evaluate(canvasColors)>100,'mobile atomic scene is blank');
  await page.screenshot({path:path.join(output,'atomic-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  for(const [name,text] of [
    ['Si.cif','data_Si\n_cell_length_a 3.839589\n_cell_length_b 3.839589\n_cell_length_c 3.839589\n_cell_angle_alpha 60\n_cell_angle_beta 60\n_cell_angle_gamma 60\n_space_group_name_H-M_alt \'P 1\'\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nSi1 Si 0 0 0\nSi2 Si 0.25 0.25 0.25\n'],
    ['POSCAR','Si diamond\n1.0\n0 2.715 2.715\n2.715 0 2.715\n2.715 2.715 0\nSi\n2\nDirect\n0 0 0\n0.25 0.25 0.25\n'],
  ]){
    const target=path.join(profile,name);await writeFile(target,text);
    await page.locator('#atomic-dimensionality').selectOption('3');
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},target);
    await page.locator('#atomic-import').click();await page.waitForFunction(value=>document.querySelector('#atomic-name').textContent===value,name);
    assert.match(await page.locator('#atomic-size').innerText(),/2 原子 · 3D/);
  }
  const invalidFile=path.join(profile,'invalid.xyz');await writeFile(invalidFile,'1\nno cell\nSi 0 0 0\n');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},invalidFile);
  await page.locator('#atomic-import').click();await page.locator('#toast').filter({hasText:'结构导入失败'}).waitFor();
  assert.equal(await page.locator('#atomic-name').innerText(),'POSCAR');
  const file=path.join(profile,'Si.xyz');await writeFile(file,'2\nLattice="0 2.715 2.715 2.715 0 2.715 2.715 2.715 0" Properties=species:S:1:pos:R:3 pbc="T T T"\nSi 0 0 0\nSi 1.3575 1.3575 1.3575\n');
  await page.locator('#atomic-dimensionality').selectOption('3');
  await app.evaluate(({dialog},target)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});},file);
  await page.locator('#atomic-import').click();await page.waitForFunction(()=>document.querySelector('#atomic-name').textContent==='Si.xyz');
  assert.match(await page.locator('#atomic-size').innerText(),/2 原子 · 3D/);
  assert.ok(await page.locator('#atomic-model-info').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'structure provenance overflows the inspector');
  if(!viewOnly){
    await page.locator('#atomic-probe').click();await page.locator('#atomic-backend').filter({hasText:'赝势校验通过'}).waitFor({timeout:60000});
    await page.locator('#atomic-run').click();await page.locator('#atomic-status').filter({hasText:'运行中'}).waitFor({timeout:20000});
    let runningInfo,stage='';const deadline=Date.now()+180000;
    while(Date.now()<deadline){
      runningInfo=await page.evaluate(()=>window.virtualFabDft.inspect(JSON.parse(localStorage.getItem('virtualfab.project.v1')).dft.jobs[0]));
      const current=`${runningInfo.progress?.case||''} ${runningInfo.progress?.stage||''}`;
      if(current!==stage){stage=current;console.log('Desktop QE: '+current.trim());}
      if(runningInfo.status.state==='failed'||runningInfo.progress?.completedCases>=1)break;
      await delay(500);
    }
    assert.equal(runningInfo.status.state,'running',runningInfo.status.message);assert.ok(runningInfo.progress?.completedCases>=1,'baseline did not finish before timeout');
    await page.locator('#atomic-cancel').click();await page.locator('#atomic-status').filter({hasText:'已取消'}).waitFor({timeout:20000});
    await page.locator('#atomic-resume').click();
    await page.locator('#atomic-status').filter({hasText:/^已完成/}).waitFor({timeout:600000});
    assert.equal(await page.locator('#atomic-band-plot [role="img"]').count(),1);
    assert.match(await page.locator('#atomic-result').innerText(),/Kohn–Sham/);
    const config=await page.evaluate(()=>JSON.parse(localStorage.getItem('virtualfab.project.v1')).dft);
    assert.equal(config.jobs.length,1);
    const info=await page.evaluate(id=>window.virtualFabDft.inspect(id),config.jobs[0]);
    assert.equal(info.status.attempt,2);assert.ok(info.result.baseline.sampledGapEv>0.3);assert.ok(info.result.baseline.sampledGapEv<0.9);
    assert.ok(Object.keys(info.result.baseline.artifacts).every(file=>file.startsWith('attempts/1/base/')),'completed base case must be reused from the original attempt');
    assert.ok(info.result.cases.some(row=>Object.keys(row.artifacts).some(file=>file.startsWith('attempts/2/'))),'unfinished scans must run in the retry attempt');
    await page.locator('#atomic-result').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'atomic-si-results.png')});
    await page.locator('#atomic-band-plot').screenshot({path:path.join(output,`atomic-si-bands-${packaged?'packaged':'dev'}.png`)});
    await page.setViewportSize({width:390,height:844});
    assert.ok((await page.locator('#atomic-band-plot').boundingBox())?.height>150,'mobile band plot collapses');
    assert.ok(await page.locator('#atomic-band-plot svg text').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize)*node.getScreenCTM().a)>=11,'mobile band labels are too small');
    await page.locator('#atomic-band-plot').screenshot({path:path.join(output,'atomic-si-bands-mobile.png')});
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#atomic-settings summary').click();await page.locator('#atomic-form [name="kSampling"]').fill('18');
    assert.match(await page.locator('#atomic-binding').innerText(),/历史任务/);
  }
  const saved=path.join(profile,'atomic-project.json');
  await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},saved);
  await page.locator('#save-as-project').click();await page.locator('#save-status').filter({hasText:'已保存'}).waitFor();
  const data=JSON.parse(await readFile(saved,'utf8'));assert.equal(data.dft.structure.name,'Si.xyz');
  await page.locator('#new-project').click();await page.locator('#confirm-ok').click();
  assert.equal(await page.locator('#atomic-name').innerText(),'Si diamond primitive');
  assert.equal(await page.locator('#atomic-band-plot svg').count(),0);
  await app.evaluate(({dialog},target)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});},saved);
  await page.locator('#open-project').click();await page.waitForFunction(()=>document.querySelector('#atomic-name').textContent==='Si.xyz');
  if(!viewOnly){await page.locator('#atomic-binding').filter({hasText:'历史任务'}).waitFor();assert.equal(await page.locator('#atomic-band-plot svg').count(),1);}
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(`Atomic desktop ${packaged?'packaged':'development'} passed: import, interactive nonblank canvas, mobile, save/open${viewOnly?'':', real QE cancel/resume and historical results'}.`);
}finally{await app?.close();}
