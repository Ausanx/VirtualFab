import assert from 'node:assert/strict';
import { mkdir,mkdtemp,writeFile,appendFile } from 'node:fs/promises';
import path from 'node:path';
import { PhysicsJobs } from '../solver/jobs.mjs';
import { siliconBenchmark } from '../src/device-model.js';
const output=path.resolve('artifacts/device-equilibrium');await mkdir(output,{recursive:true});const root=await mkdtemp(path.join(output,'jobs-'));
const jobs=new PhysicsJobs({root});await jobs.init();const report=[];
for(const name of ['pn','pin','coarse']){
  const p=siliconBenchmark(name==='pin');if(name==='coarse'){
    p.devicePhysics.regions[0].acceptor.value=1e15;p.devicePhysics.regions.at(-1).donor.value=1e17;p.devicePhysics.path.meshNm=100;
  }
  const {id}=await jobs.start(p,0);await jobs.active?.done;
  const info=await jobs.inspect(id),r=info.result;assert.equal(info.status.state,'completed');assert.ok(r.converged);
  assert.equal(r.accuracyPassed,name!=='coarse');assert.equal(r.validation.experiment.state,'unchecked');
  if(name!=='coarse'){const t=r.depletion.thresholds[1];assert.ok(t.pWidthUm>0&&t.nWidthUm>0);assert.ok(t.spanUm>r.config.intrinsicLengthUm);}
  // History verification must not depend on launching an installed solver.
  const reader=new PhysicsJobs({root,solve:()=>{throw Error('No backend available.');}});assert.deepEqual((await reader.inspect(id)).result,r);
  const row={name,id,inputHash:info.manifest.inputHash,config:r.config,builtInV:r.builtInV,validation:r.validation,depletion:r.depletion,accuracyPassed:r.accuracyPassed};report.push(row);
  await writeFile(path.join(output,name+'.json'),JSON.stringify(info,null,2)+'\n');
  if(name==='coarse'){await appendFile(path.join(root,id,'result.json'),'\n');await assert.rejects(()=>reader.inspect(id),/结果校验失败/);}
}
const canceled=await jobs.start(siliconBenchmark(true),0);await jobs.cancel(canceled.id);assert.equal((await jobs.inspect(canceled.id)).status.state,'canceled');
await writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2)+'\n');
console.log('Mapped equilibrium validation passed: real PN/PIN, quantitative depletion criteria, failed-accuracy result preserved, real cancellation, hashes, and history without launching a backend.');
