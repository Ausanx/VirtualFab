import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../server.mjs';

test('local server exposes only app assets and read-only HTTP methods', async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const path of ['/','/src/app.js','/node_modules/three/build/three.module.js','/node_modules/three/examples/jsm/controls/OrbitControls.js']) {
      const response=await fetch(base+path);
      assert.equal(response.status,200,path);
      assert.ok(response.headers.get('content-security-policy').includes("connect-src 'self'"));
    }
    for(const path of ['/README.md','/package.json','/docs/plans/2026-09-24-virtualfab-design.md','/node_modules/three/build/%2e%2e%2f%2e%2e%2f%2e%2e%2fsrc/app.js'])
      assert.equal((await fetch(base+path)).status,404,path);
    assert.equal(await (await fetch(base,{method:'HEAD'})).text(),'');
    assert.equal((await fetch(base,{method:'POST',body:'data'})).status,405);
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
});
