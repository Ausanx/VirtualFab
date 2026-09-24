import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { server } from '../server.mjs';

// Isolated port and browser profile: verification never modifies a user's saved project.
await mkdir('artifacts',{recursive:true});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({headless:true,channel:process.env.VIRTUALFAB_BROWSER||(process.platform==='win32'?'msedge':undefined)});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
  page.on('request',request=>{if(!request.url().startsWith(url)&&!request.url().startsWith('blob:'))external.push(request.url());});
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('virtualfab.project.v1')));
  const clickStep=index=>page.locator(`.recipe-card[data-index="${index}"]`).click();
  const loadTemplate=async name=>{
    await page.locator('#template').selectOption(name);
    await page.locator('#load-template').click();
    await page.locator('#confirm-ok').click();
    assert.match(await page.locator('#simulation-status').innerText(),/几何计算完成/);
  };
  await page.goto(url);
  await page.locator('#three-view canvas').waitFor();
  assert.equal(await page.locator('.recipe-card').count(),22);
  await page.locator('[data-panel="results"]').click();
  assert.match(await page.locator('#results-panel').innerText(),/MIM/);
  await page.screenshot({path:'artifacts/desktop-crossbar.png',fullPage:true});

  // NR9 process playback and actual parameter persistence.
  await page.locator('[data-panel="params"]').click();
  await clickStep(3);
  assert.match(await page.locator('#layer-legend').innerText(),/NR9-3000PY/);
  await page.locator('#param-form [name="thicknessNm"]').fill('2400');
  await page.locator('#param-form button[type="submit"]').click();
  assert.equal((await saved()).steps[3].params.thicknessNm,2400);
  await clickStep(5);
  assert.match(await page.locator('.inspector-title').innerText(),/曝光/);
  await clickStep(8);
  assert.doesNotMatch(await page.locator('#layer-legend').innerText(),/NR9-3000PY/);

  // Duplicate, reorder, disable, remove and add using the exposed controls.
  await clickStep(2);
  await page.locator('[data-action="duplicate"]').click();
  await page.locator('[data-action="up"]').click();
  await page.locator('[data-action="down"]').click();
  await page.locator('#param-form [name="stepEnabled"]').uncheck();
  await page.locator('#param-form button[type="submit"]').click();
  assert.equal((await saved()).steps[3].enabled,false);
  await page.locator('[data-action="delete"]').click();
  await page.locator('[data-add="anneal"]').click();
  assert.equal((await saved()).steps[3].type,'anneal');
  await page.locator('[data-action="delete"]').click();
  assert.equal(await page.locator('.recipe-card').count(),22);
  await page.locator('#run-all').click();
  await page.locator('#slice-range').fill('4');
  assert.equal(await page.locator('#slice-value').innerText(),'-15.5');
  for(const id of ['view-top','view-front','view-perspective','explode','explode','wafer-view','wafer-view'])await page.locator('#'+id).click();
  await page.reload();
  await page.locator('.recipe-card').first().waitFor();
  assert.equal((await saved()).steps[3].params.thicknessNm,2400);

  // Missing data, evidence validation and a custom local material.
  await page.locator('#open-materials').click();
  await page.locator('[data-material="InON"]').click();
  assert.equal(await page.locator('#prop-bandGap').isDisabled(),true);
  await page.locator('[name="bandGap-evidence"]').selectOption('measured');
  await page.locator('#prop-bandGap').fill('1.7');
  await page.locator('#material-form button[type="submit"]').click();
  assert.match(await page.locator('#material-error').innerText(),/来源和测量条件/);
  await page.locator('[name="bandGap-evidence"]').selectOption('estimated');
  await page.locator('[name="bandGap-note"]').fill('浏览器测试示例，非文献值');
  await page.locator('#material-form button[type="submit"]').click();
  assert.equal((await saved()).materials.find(m=>m.id==='InON').bandGap.value,1.7);
  await page.locator('#new-material').click();
  await page.locator('#material-form [name="id"]').fill('test-n');
  await page.locator('#material-form [name="name"]').fill('测试半导体');
  await page.locator('#material-form [name="polarity"]').selectOption('n');
  await page.locator('#material-form button[type="submit"]').click();
  assert.ok((await saved()).materials.some(m=>m.id==='test-n'));
  const dialogBounds=await page.locator('#materials-dialog').boundingBox(),headingBounds=await page.locator('#materials-dialog .dialog-heading').boundingBox();
  assert.ok(headingBounds.y>=dialogBounds.y&&headingBounds.y+headingBounds.height<=dialogBounds.y+dialogBounds.height,'material dialog heading remains visible after saving');
  await page.screenshot({path:'artifacts/material-library.png',fullPage:true});
  await page.locator('#close-materials').click();

  for(const [name,label]of [['backgate','底栅 FET'],['topgate','顶栅 FET'],['pn','PN 异质结']]) {
    await loadTemplate(name);
    await page.locator('[data-panel="results"]').click();
    assert.ok((await page.locator('#results-panel').innerText()).includes(label));
    if(name==='topgate')await page.screenshot({path:'artifacts/desktop-topgate.png',fullPage:true});
  }
  assert.ok((await saved()).materials.some(m=>m.id==='test-n'));
  await page.locator('[data-view="bands"]').click();
  assert.match(await page.locator('#interface-results').innerText(),/带阶数据不足/);
  await page.screenshot({path:'artifacts/bands-pn.png',fullPage:true});

  // Export/import round trip, invalid import isolation and the manual CSV model.
  const exportEvent=page.waitForEvent('download');
  await page.locator('#export-project').click();
  const exported=await exportEvent;
  await exported.saveAs('artifacts/browser-project.json');
  const exportedData=JSON.parse(await readFile('artifacts/browser-project.json','utf8'));
  assert.deepEqual(exportedData,await saved());
  await page.locator('#project-name').fill('临时改名');
  await page.locator('#project-name').press('Tab');
  await page.locator('#project-file').setInputFiles('artifacts/browser-project.json');
  await page.locator('#confirm-ok').click();
  assert.deepEqual(await saved(),exportedData);
  await page.locator('#project-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":500}')});
  await page.locator('#toast').filter({hasText:'导入失败'}).waitFor();
  assert.deepEqual(await saved(),exportedData);
  await page.locator('[data-view="electrical"]').click();
  await page.locator('#curve-form [name="photocurrentA"]').fill('1e-8');
  await page.locator('#curve-form button[type="submit"]').click();
  const csvEvent=page.waitForEvent('download');
  await page.locator('#export-curve').click();
  await (await csvEvent).saveAs('artifacts/browser-curve.csv');
  assert.equal((await readFile('artifacts/browser-curve.csv','utf8')).trim().split('\n').length,102);
  await page.locator('#curve-form [name="ideality"]').fill('0.1');
  await page.locator('#curve-form [name="temperatureK"]').fill('1');
  let badDownload=false;const onDownload=()=>{badDownload=true;};page.on('download',onDownload);
  await page.locator('#export-curve').click();
  assert.match(await page.locator('#curve-plot').innerText(),/超出数值范围/);
  assert.equal(badDownload,false,'invalid curve parameters must not export previous results');
  page.off('download',onDownload);
  await page.locator('#curve-form [name="ideality"]').fill('1.5');
  await page.locator('#curve-form [name="temperatureK"]').fill('300');
  await page.locator('#curve-form button[type="submit"]').click();
  await page.screenshot({path:'artifacts/electrical-model.png',fullPage:true});
  await page.locator('[data-view="structure"]').click();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile content should not overflow horizontally');
  await page.screenshot({path:'artifacts/mobile.png',fullPage:true});
  assert.deepEqual(external,[],'the app must not transmit project data or request remote assets');
  assert.deepEqual(errors,[],'no browser errors');
  console.log('Browser checks passed: WebGL, process editing/replay, templates, materials, local persistence, JSON/CSV, mobile layout.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
