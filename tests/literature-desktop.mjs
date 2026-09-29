import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { references } from '../benchmarks/literature.mjs';

const packaged = process.argv.includes('--packaged');
const output = path.resolve('artifacts/literature');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'desktop-profile-'));
const errors = [], external = [];
let app;

async function checkCanvas(page, target) {
  const buffer = await page.locator('#three-view canvas').screenshot({ path: target });
  const colors = await page.evaluate(async base64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const unique = new Set();
    for (let i = 0; i < pixels.length; i += 64) unique.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return unique.size;
  }, buffer.toString('base64'));
  assert.ok(colors > 12, `3D canvas is blank or nearly uniform: ${colors} colors`);
}

try {
  app = await electron.launch({
    executablePath: packaged ? path.resolve('dist/VirtualFab-win32-x64/VirtualFab.exe') : undefined,
    args: [...(packaged ? [] : ['.']), `--user-data-dir=${profile}`], cwd: process.cwd(), timeout: 30000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!/^(virtualfab:|data:|blob:)/.test(r.url())) external.push(r.url()); });
  await page.locator('#three-view canvas').waitFor();
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  for (const key of Object.keys(references)) {
    const filename = path.resolve(`examples/literature/${key}.json`);
    const project = JSON.parse(await readFile(filename, 'utf8'));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-view="structure"]').click();
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, filename);
    await page.locator('#open-project').click();
    await page.waitForFunction(name => document.querySelector('#project-name').value === name, project.name);
    assert.match(await page.locator('#simulation-status').innerText(), /几何计算完成/);
    await page.locator('#first-step').click();
    for (let i = 0; i < project.steps.length; i++) {
      await page.locator('#next-step').click();
      assert.equal(await page.locator('.recipe-card.current').getAttribute('data-index'), String(i));
      if (project.steps[i].type === 'expose') {
        const values = await page.locator('#mask-target').evaluate(canvas => {
          const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          const red = new Set();
          for (let k = 0; k < rgba.length; k += 4) red.add(rgba[k]);
          return red.size;
        });
        assert.equal(values, 2, `${key} EBL mask should show openings and protection`);
      }
    }
    const result = await page.locator('#results-panel').innerText();
    if (key === 'radisavljevic2011') assert.match(result, /双栅 FET/);
    if (key === 'lee2014') assert.match(result, /PN 异质结/);
    if (key === 'chiu2015') assert.match(result, /Type-II 异质界面（文献档案）/);
    await checkCanvas(page, path.join(output, `${key}-canvas.png`));
    await page.screenshot({ path: path.join(output, `${key}-structure.png`) });
    await page.locator('[data-view="bands"]').click();
    if (key === 'lee2014') {
      const bands = await page.locator('#interface-results').innerText();
      assert.match(bands, /带阶数据不足/);
      assert.match(bands, /光学带隙/);
    }
    if (key === 'chiu2015') {
      assert.match(await page.locator('#interface-results').innerText(), /Type-II/);
      assert.match(await page.locator('#interface-results').innerText(), /-0\.76/);
      assert.match(await page.locator('#interface-results').innerText(), /-0\.83/);
      assert.equal(await page.getByRole('img',{name:'界面相对带边',exact:true}).count(),1);
      assert.ok(await page.locator('#band-diagram').getByText('带边缺失', { exact: true }).count() >= 2);
    }
    await page.screenshot({ path: path.join(output, `${key}-bands.png`) });
    await page.locator('[data-view="structure"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await checkCanvas(page, path.join(output, `${key}-mobile-canvas.png`));
    await page.screenshot({ path: path.join(output, `${key}-mobile.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(`Literature desktop ${packaged ? 'packaged' : 'development'} checks passed: native open, step replay, mask, topology, band limits, desktop/mobile canvas pixels and no remote requests.`);
} finally {
  await app?.close();
}
