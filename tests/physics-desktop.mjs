import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {_electron as electron} from 'playwright';

const packaged=process.argv.includes('--packaged'),output=path.resolve('artifacts/physics-ui');
await mkdir(output,{recursive:true});const profile=await mkdtemp(path.join(output,'profile-'));
let app;const errors=[],requests=[];
async function exportCsv(page,name){
  const file=path.join(profile,name);
  await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},file);
  await page.locator('#export-equilibrium').click();
  for(let attempt=0;attempt<100;attempt++){
    try{return await readFile(file,'utf8');}
    catch(error){if(error.code!=='ENOENT')throw error;await delay(50);}
  }
  throw Error(`CSV export timed out: ${name}`);
}
try{
  app=await electron.launch({executablePath:packaged?path.resolve('dist/VirtualFab-win32-x64/VirtualFab.exe'):undefined,args:[...(packaged?[]:['.']),`--user-data-dir=${profile}`],cwd:process.cwd(),env:{...process.env,PATH:process.env.SystemRoot+'\\System32',DEVSIM_MATH_LIBS:'missing-test-math-library.dll'},timeout:30000});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!/^(virtualfab:|data:|blob:)/.test(r.url()))requests.push(r.url());});
  await page.locator('#three-view canvas').waitFor();await page.setViewportSize({width:1440,height:1000});
  const project=path.resolve('examples/literature/chiu2015.json');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},project);
  await page.locator('#open-project').click();
  await page.waitForFunction(()=>document.querySelector('#project-name').value.includes('实测带隙'));
  await page.locator('[data-view="bands"]').click();
  assert.match(await page.locator('#interface-results').innerText(),/Type-II/);
  assert.match(await page.locator('#interface-results').innerText(),/-0\.76/);
  await page.locator('[data-interface-confirm]').uncheck();
  assert.match(await page.locator('#interface-results').innerText(),/尚未确认/);
  assert.equal(await page.getByRole('img',{name:'界面相对带边',exact:true}).count(),0);
  await page.locator('[data-interface-confirm]').check();
  assert.equal(await page.getByRole('img',{name:'界面相对带边',exact:true}).count(),1);
  await page.locator('#interface-results').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'relative-bands.png')});
  await page.locator('#open-materials').click();await page.locator('[data-material="MoS2"]').click();
  const prior=await page.evaluate(()=>JSON.parse(localStorage.getItem('virtualfab.project.v1')).materials.find(m=>m.id==='MoS2'));
  assert.equal(await page.locator('[name="bandGap-kind"]').inputValue(),'quasiparticle');
  await page.locator('#material-form [name="name"]').fill('MoS₂ STS 标定');
  await page.locator('#material-form button[type="submit"]').click();
  const updated=await page.evaluate(()=>JSON.parse(localStorage.getItem('virtualfab.project.v1')).materials.find(m=>m.id==='MoS2'));
  assert.deepEqual(updated.bandGap,prior.bandGap);assert.deepEqual(updated.affinity,{...prior.affinity,reference:'unspecified'});
  await page.locator('#close-materials').click();
  await page.locator('#grid-settings').click();await page.locator('#grid-form [name="resolution"]').fill('40');
  await page.locator('#compare-grids').click();
  assert.match(await page.locator('#grid-results').innerText(),/20 列/);assert.match(await page.locator('#grid-results').innerText(),/80 列/);
  await page.locator('#grid-dialog').screenshot({path:path.join(output,'grid-comparison.png')});
  await page.locator('#grid-form button[type="submit"]').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('virtualfab.project.v1')).resolution),40);
  assert.equal(await page.locator('#slice-range').getAttribute('max'),'39');
  await page.locator('[data-band-mode="equilibrium"]').click();
  await page.locator('#solve-equilibrium').click();await page.locator('#equilibrium-status').filter({hasText:'已收敛'}).waitFor({timeout:45000});
  assert.match(await page.locator('#equilibrium-summary').innerText(),/0\.73521/);
  assert.equal(await page.locator('#equilibrium-plot [data-series="efEv"]').count(),1);
  const lines=(await exportCsv(page,'pn-nodes.csv')).trim().split('\n');assert.ok(lines.length>800);
  assert.match(lines[0],/electronCm3/);
  await page.locator('#equilibrium-settings summary').click();await page.locator('#equilibrium-form [name="intrinsicLengthUm"]').fill('1');
  assert.ok(await page.locator('#export-equilibrium').isDisabled());assert.equal(await page.locator('#equilibrium-plot svg').count(),0);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('virtualfab.project.v1')).equilibrium.intrinsicLengthUm),1);
  await page.locator('#solve-equilibrium').click();await page.locator('#equilibrium-status').filter({hasText:'已收敛'}).waitFor({timeout:45000});
  assert.match(await page.locator('#equilibrium-status').innerText(),/PIN/);
  await page.screenshot({path:path.join(output,'pin-desktop.png')});
  await page.locator('#equilibrium-quantity').selectOption('carriers');
  assert.equal(await page.locator('#equilibrium-plot [data-series="electronCm3"]').count(),1);
  await page.screenshot({path:path.join(output,'pin-carriers.png')});
  await page.locator('#equilibrium-quantity').selectOption('field');
  assert.equal(await page.locator('#equilibrium-plot [data-series="fieldVcm"]').count(),1);
  await page.screenshot({path:path.join(output,'pin-field.png')});
  const fieldLines=(await exportCsv(page,'pin-field.csv')).trim().split('\n');
  assert.equal(fieldLines[0].trim(),'xUm,fieldVcm');assert.ok(fieldLines.length>1000);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#equilibrium-plot').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  await page.screenshot({path:path.join(output,'pin-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#equilibrium-settings summary').click();
  await page.locator('#equilibrium-form [name="nLengthUm"]').fill('2.5');
  assert.ok(await page.locator('#export-equilibrium').isDisabled());
  const file=path.join(output,'saved-physics.json');
  await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},file);
  await page.locator('#save-as-project').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已保存'));
  const saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.equilibrium.intrinsicLengthUm,1);assert.equal(saved.equilibrium.nLengthUm,2.5);assert.equal(saved.interfaceSelections[0].conditionsConfirmed,true);
  await page.locator('#new-project').click();await page.locator('#confirm-ok').click();
  assert.equal(await page.locator('#equilibrium-form [name="intrinsicLengthUm"]').inputValue(),'0');
  assert.ok(await page.locator('#export-equilibrium').isDisabled());
  await app.evaluate(({dialog},target)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});},file);
  await page.locator('#open-project').click();
  await page.waitForFunction(()=>document.querySelector('#equilibrium-form [name="intrinsicLengthUm"]').value==='1');
  assert.equal(await page.locator('#equilibrium-form [name="nLengthUm"]').inputValue(),'2.5');
  await page.locator('#solve-equilibrium').click();await page.locator('#equilibrium-status').filter({hasText:'已收敛'}).waitFor({timeout:45000});
  assert.equal(await page.locator('#equilibrium-plot [data-series="fieldVcm"]').count(),1);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(`Physics desktop ${packaged?'packaged':'development'} passed: condition gate, relative bands, metadata preservation, grid control, PN/PIN solve, carriers/field, both CSV exports, mobile layout, unsolved parameter save/open and no remote requests.`);
}finally{await app?.close();}
