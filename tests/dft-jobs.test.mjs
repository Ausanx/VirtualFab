import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,mkdir,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { DftJobs } from '../dft/jobs.mjs';
import { atomicTemplate } from '../src/atomic.js';

async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'virtualfab-jobs-'));
  const children=[];
  const launch=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();children.push(child);return child;};
  const jobs=new DftJobs({root,launch,invoke:async()=>({ready:true,engine:'test orchestration only'})});
  await jobs.init();return {root,jobs,children};
}
test('input snapshots are immutable and failed processes cannot become successful results',async()=>{
  const {root,jobs,children}=await fixture(),config=atomicTemplate();
  const job=await jobs.start(config);config.settings.kDensity=10;
  const saved=JSON.parse(await readFile(path.join(root,job.id,'snapshot.json'),'utf8'));
  assert.equal(saved.settings.kDensity,6);assert.equal((await jobs.inspect(job.id)).status.state,'running');
  children[0].emit('close',1);await jobs.active?.done;
  assert.equal((await jobs.inspect(job.id)).status.state,'failed');
  await assert.rejects(()=>jobs.inspect('../outside'));
  await writeFile(path.join(root,job.id,'snapshot.json'),'{}');
  await assert.rejects(()=>jobs.resume(job.id),/快照/);
});
test('cancel keeps evidence and relaunch recovers interrupted tasks',async()=>{
  const {root,jobs,children}=await fixture(),job=await jobs.start(atomicTemplate());
  await jobs.cancel(job.id);assert.equal((await jobs.inspect(job.id)).status.state,'canceling');
  children[0].emit('close',1);await jobs.active?.done;
  assert.equal((await jobs.inspect(job.id)).status.state,'canceled');
  await jobs.resume(job.id);assert.equal(children.length,2);
  const recovered=new DftJobs({root,invoke:async()=>({ready:true})});await recovered.init();
  assert.equal((await recovered.inspect(job.id)).status.state,'interrupted');
  assert.ok(await readFile(path.join(root,job.id,'cancel'),'utf8'));
  children[1].emit('close',1);await jobs.active?.done;
});
test('missing project-local task references are explicit',async()=>{
  const {jobs}=await fixture(),id='00000000-0000-4000-8000-000000000000';
  const list=await jobs.list([id]);assert.equal(list[0].status.state,'missing');
  assert.equal(list[0].id,id);
});
async function completeFixture(f){
  const job=await f.jobs.start(atomicTemplate()),directory=path.join(f.root,job.id);
  const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  const evidence='attempts/1/base/scf.out';await mkdir(path.dirname(path.join(directory,evidence)),{recursive:true});
  await writeFile(path.join(directory,evidence),'test evidence, not a physics result');
  const cases=['base','cutoff','density','sampling'].map(name=>({name,scfConverged:true,totalEnergyEv:-100,sampledGapEv:.5,artifacts:{[evidence]:createHash('sha256').update('test evidence, not a physics result').digest('hex')}}));
  await writeFile(path.join(directory,'result.json'),JSON.stringify({schemaVersion:1,inputHash:manifest.inputHash,config:manifest.config,cases,baseline:cases[0],sensitivity:{allWithinTolerance:true}}));
  const done=f.jobs.active.done;f.children[0].emit('close',0);await done;
  return {job,directory};
}
test('completed results reject modified evidence and result files',async()=>{
  const f=await fixture(),{job,directory}=await completeFixture(f);
  assert.equal((await f.jobs.inspect(job.id)).status.state,'completed');
  const file=path.join(directory,'result.json'),original=await readFile(file,'utf8');
  await writeFile(file,original.replace('"sampledGapEv":0.5','"sampledGapEv":5'));
  await assert.rejects(()=>f.jobs.inspect(job.id),/校验|损坏/);
  await writeFile(file,original);await writeFile(path.join(directory,'attempts/1/base/scf.out'),'modified evidence');
  await assert.rejects(()=>f.jobs.inspect(job.id),/证据|校验|损坏/);
  const list=await f.jobs.list([job.id]);assert.equal(list[0].status.state,'corrupted');
});
test('manifest cannot mislabel a valid snapshot',async()=>{
  const f=await fixture(),job=await f.jobs.start(atomicTemplate()),file=path.join(f.root,job.id,'manifest.json');
  const manifest=JSON.parse(await readFile(file,'utf8'));manifest.config.settings.kDensity=10;await writeFile(file,JSON.stringify(manifest));
  await assert.rejects(()=>f.jobs.inspect(job.id),/快照/);
  f.children[0].emit('close',1);await f.jobs.active?.done;
});
test('cancel racing with process exit leaves a terminal state',async()=>{
  const f=await fixture(),job=await f.jobs.start(atomicTemplate()),done=f.jobs.active.done;
  const cancel=f.jobs.cancel(job.id);f.children[0].emit('close',1);await cancel;await done;
  assert.equal((await f.jobs.inspect(job.id)).status.state,'canceled');
  assert.equal(f.jobs.active,null);
});
test('closing during backend probe cannot launch an orphan calculation',async()=>{
  const f=await fixture();let release;
  f.jobs.invoke=()=>new Promise(resolve=>{release=resolve;});
  const pending=f.jobs.start(atomicTemplate());await f.jobs.close();release({ready:true});
  await assert.rejects(pending,/退出|关闭/);
  assert.equal(f.children.length,0);
});
test('one corrupt task status cannot prevent application startup',async()=>{
  const f=await fixture(),id='00000000-0000-4000-8000-000000000000',directory=path.join(f.root,id);
  await mkdir(directory);await writeFile(path.join(directory,'status.json'),'{broken');
  const recovered=new DftJobs({root:f.root});await recovered.init();
  assert.equal((await recovered.list([id]))[0].status.state,'corrupted');
});
test('missing or malformed live status is canceled and recoverable without overwriting evidence',async()=>{
  for(const content of ['null','{}','{"state":"unknown"}','{broken',null]){
    const f=await fixture(),{job,directory}=await completeFixture(f);
    await mkdir(path.join(directory,'attempts/3/base'),{recursive:true});
    const statusFile=path.join(directory,'status.json');
    if(content===null){const {unlink}=await import('node:fs/promises');await unlink(statusFile);}else await writeFile(statusFile,content);
    const recovered=new DftJobs({root:f.root,invoke:async()=>({idle:true}),launch:f.jobs.launch});await recovered.init();
    const info=await recovered.inspect(job.id);assert.equal(info.status.state,'interrupted');assert.equal(info.status.attempt,3);
    assert.ok(await readFile(path.join(directory,'cancel'),'utf8'));
    if(content!==null){
      const backup=(await readdir(directory)).find(file=>file.startsWith('status.invalid-'));
      assert.ok(backup,'malformed status must remain available for diagnosis');
      assert.equal(await readFile(path.join(directory,backup),'utf8'),content);
    }
    await recovered.resume(job.id);assert.equal((await recovered.inspect(job.id)).status.attempt,4);
    const done=recovered.active.done;f.children.at(-1).emit('close',1);await done;
  }
});
