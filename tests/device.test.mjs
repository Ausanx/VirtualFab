import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { siliconBenchmark,mapDevice,physicsGeometry,emptyDevicePhysics,physicalRegion,geometrySnapshot,resolveBinding } from '../src/device-model.js';
import { validateProject } from '../src/engine.js';
import { step,createProject } from '../src/recipes.js';
import { PhysicsJobs } from '../solver/jobs.mjs';

test('PN and PIN use exact geometry lengths and physical dopants, not candidate polarity',()=>{
  for(const pin of [false,true]){
    const p=siliconBenchmark(pin),before=JSON.stringify(p),m=mapDevice(p);
    assert.equal(m.config.pLengthUm,2);assert.equal(m.config.nLengthUm,2);assert.equal(m.config.intrinsicLengthUm,pin?1:0);
    assert.equal(m.config.acceptorCm3,1e16);assert.equal(m.config.donorCm3,1e16);assert.equal(m.crossSectionUm2,32);
    assert.equal(m.boundaries.start.kind,'truncation');assert.match(m.boundaries.start.assumption,/不是真实/);
    assert.equal(JSON.stringify(p),before);assert.deepEqual(mapDevice(validateProject(JSON.parse(before))),m);
  }
  validateProject(createProject());
  const bad=siliconBenchmark();bad.devicePhysics.regions[0].acceptor.unit='cm^-2';assert.throws(()=>validateProject(bad),/面密度/);
});
test('unknown is stored but cannot become zero; compensation and unsupported ionization are rejected',()=>{
  for(const mutate of [
    p=>{p.devicePhysics.regions[0].donor={value:null,evidence:'missing',source:'',note:''};},
    p=>p.devicePhysics.regions[0].donor.value=1e14,
    p=>p.devicePhysics.regions[0].ionization='partial',
    p=>p.devicePhysics.regions[0].basis='carrier',
    p=>{p.devicePhysics.regions[0].basis='nominal';p.devicePhysics.regions[0].activation=.9;},
    p=>p.devicePhysics.regions[0].assumption='',
  ]){const p=siliconBenchmark();mutate(p);validateProject(JSON.parse(JSON.stringify(p)));assert.throws(()=>mapDevice(p));}
});
test('geometry and grid changes invalidate spatial bindings while cosmetic project names do not',()=>{
  for(const mutate of [p=>p.resolution=32,p=>p.sizeUm=10,p=>p.steps[0].params.oxideNm=10,p=>p.steps[0].params.waferThicknessUm=5,p=>p.steps.push(step('clean')),p=>p.materials.find(m=>m.id==='Si').polarity='p']){
    const p=siliconBenchmark();mutate(p);assert.throws(()=>mapDevice(p,p.steps.length-1),/失效/);
  }
  const p=siliconBenchmark();p.name='仅改名';mapDevice(p);
});
test('spatial gaps, overlap, transverse variation and wrong orientation cannot submit',()=>{
  for(const mutate of [p=>p.devicePhysics.regions[0].box.x1=-.1,p=>p.devicePhysics.regions[0].box.x1=.1,p=>p.devicePhysics.regions[0].box.y1=3,p=>p.devicePhysics.regions[0].box.z1=-.1,p=>p.devicePhysics.path.z=1,p=>p.devicePhysics.path.startUm=-10,p=>p.devicePhysics.path.endUm=-1]){
    const p=siliconBenchmark();mutate(p);assert.throws(()=>mapDevice(p));
  }
  const p=siliconBenchmark();p.devicePhysics.path.startUm=2;p.devicePhysics.path.endUm=-2;assert.throws(()=>mapDevice(p),/p–n/);
  [p.devicePhysics.regions[0].box,p.devicePhysics.regions[1].box]=[p.devicePhysics.regions[1].box,p.devicePhysics.regions[0].box];
  assert.equal(mapDevice(p).direction,-1);
});
test('Y and Z paths use the full transverse component, including multiple connected Si depositions',()=>{
  const p=siliconBenchmark();p.devicePhysics.path={...p.devicePhysics.path,axis:'y',x:0,startUm:-2,endUm:2};
  for(const [i,r]of p.devicePhysics.regions.entries())r.box={...r.binding.box,y0:i===0?-2:0,y1:i===0?0:2};
  assert.equal(mapDevice(p).axis,'y');
  p.steps=[step('substrate',{material:'glass',oxideNm:0}),step('deposit',{material:'Si',thicknessNm:2000,doping:'unknown',role:'active'}),step('deposit',{material:'Si',thicknessNm:2000,doping:'unknown',role:'active'})];
  const g=physicsGeometry(p,2),d=emptyDevicePhysics(p,2,g);d.path={...d.path,axis:'z',x:0,y:0,startUm:0,endUm:4};
  d.regions=g.graph.nodes.filter(n=>n.material==='Si').map((n,i)=>({...p.devicePhysics.regions[i],binding:n.binding,box:n.box}));p.devicePhysics=d;
  assert.equal(mapDevice(p).axis,'z');assert.equal(mapDevice(p).config.pLengthUm,2);
});
test('real metal end faces are distinct from truncations and partial contacts are refused',()=>{
  const p=siliconBenchmark();p.steps=[step('substrate',{material:'glass',oxideNm:0}),step('deposit',{material:'Au',thicknessNm:100,role:'source'}),step('deposit',{material:'Si',thicknessNm:4000,doping:'unknown',role:'active'}),step('deposit',{material:'ITO',thicknessNm:100,role:'drain'})];
  const g=physicsGeometry(p,3),si=g.graph.nodes.find(n=>n.material==='Si'),a=g.graph.nodes.find(n=>n.material==='Au'),b=g.graph.nodes.find(n=>n.material==='ITO'),d=emptyDevicePhysics(p,3,g);
  d.path={...d.path,axis:'z',x:0,y:0,startUm:.1,endUm:4.1,start:{kind:'electrode',binding:a.binding},end:{kind:'electrode',binding:b.binding}};
  d.regions=p.devicePhysics.regions.map((r,i)=>({...r,binding:si.binding,box:{...si.box,z0:i===0?.1:2.1,z1:i===0?2.1:4.1}}));p.devicePhysics=d;
  const m=mapDevice(p);assert.equal(m.boundaries.start.kind,'electrode');assert.match(m.boundaries.end.assumption,/未标定/);assert.ok(Math.abs(m.config.pLengthUm-2)<1e-10);
  p.devicePhysics.path.start={kind:'truncation'};assert.throws(()=>mapDevice(p),/支路/);
  p.steps[3]=step('transfer',{material:'ITO',thicknessNm:100,widthUm:4,lengthUm:8,role:'drain'});
  const partial=physicsGeometry(p,3);d.geometry=partial.geometry;d.path.start={kind:'electrode',binding:a.binding};d.path.end={kind:'electrode',binding:partial.graph.nodes.find(n=>n.material==='ITO').binding};
  assert.throws(()=>mapDevice(p),/完整硅端面/);
});
test('insulating i layers, connected branches and unselected conductive bypasses are rejected globally',()=>{
  for(const type of ['dielectric','branch','conductor']){
    const p=siliconBenchmark();
    if(type==='dielectric')p.steps=[step('substrate',{material:'glass',oxideNm:0}),step('deposit',{material:'Si',thicknessNm:2000}),step('deposit',{material:'HfO2',thicknessNm:1000}),step('deposit',{material:'Si',thicknessNm:2000})];
    else if(type==='branch')p.steps.push(step('transfer',{material:'Si',thicknessNm:500,widthUm:2,lengthUm:2,doping:'unknown'}));
    else p.steps.push(step('deposit',{material:'Au',thicknessNm:50}));
    p.devicePhysics.through=p.steps.length-1;p.devicePhysics.geometry=geometrySnapshot(p,p.devicePhysics.through);
    assert.throws(()=>mapDevice(p));
  }
});
test('silicon back gates and electrodes across dielectric cannot silently enter an ungated PN model',()=>{
  const p=siliconBenchmark();p.steps[0].params.backgate=true;p.devicePhysics.geometry=geometrySnapshot(p,0);assert.throws(()=>mapDevice(p),/栅极/);
  const q=siliconBenchmark();q.steps.push(step('deposit',{material:'SiO2',thicknessNm:100}),step('deposit',{material:'Au',thicknessNm:100,role:'electrode'}));q.devicePhysics.through=2;q.devicePhysics.geometry=geometrySnapshot(q,2);assert.throws(()=>mapDevice(q),/介质隔离/);
});
test('disconnected pieces retain distinct spatial anchors and do not bind by integer component ID',()=>{
  const p=siliconBenchmark();p.steps.push(step('coat',{material:'S1813'}),step('expose',{pattern:'contacts',widthUm:8,lengthUm:8,gapUm:2}),step('develop'),step('deposit',{material:'Si',thicknessNm:2000,doping:'unknown'}),step('liftoff'));
  const g=physicsGeometry(p,p.steps.length-1),pieces=g.graph.nodes.filter(n=>n.material==='Si'&&n.stepId===p.steps[4].id);
  assert.equal(pieces.length,2);assert.notDeepEqual(pieces[0].binding.anchor,pieces[1].binding.anchor);
  const binding=structuredClone(pieces[0].binding);pieces[0].id+=999;
  assert.equal(resolveBinding(g.graph,binding),pieces[0]);
  const region=physicalRegion(pieces[0]);assert.equal(region.donor.value,null);assert.equal(region.acceptor.value,null);
});
test('background tasks keep immutable snapshots, refuse concurrent work, cancel and recover interrupted states',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'virtualfab-physics-'));
  const jobs=new PhysicsJobs({root,solve:(_c,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('canceled')),{once:true}))});await jobs.init();
  const p=siliconBenchmark(),job=await jobs.start(p,0);p.devicePhysics.regions[0].acceptor.value=1e17;
  assert.equal((await jobs.inspect(job.id)).snapshot.mapping.config.acceptorCm3,1e16);
  await assert.rejects(()=>jobs.start(p,0),/运行/);await jobs.cancel(job.id);assert.equal((await jobs.inspect(job.id)).status.state,'canceled');
  await writeFile(path.join(root,job.id,'status.json'),'{broken');const recovered=new PhysicsJobs({root});await recovered.init();assert.equal((await recovered.inspect(job.id)).status.state,'interrupted');
  await writeFile(path.join(root,job.id,'snapshot.json'),'{}');await assert.rejects(()=>recovered.inspect(job.id),/校验/);
  assert.equal((await recovered.list(['00000000-0000-4000-8000-000000000000']))[0].state,'missing');
  await assert.rejects(()=>recovered.inspect('../outside'));assert.ok((await readFile(path.join(root,job.id,'manifest.json'),'utf8')).includes('inputHash'));
});
test('unconverged output stays diagnostic-only and closing during task creation cannot launch a worker',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'virtualfab-physics-failed-'));
  const jobs=new PhysicsJobs({root,solve:async()=>({schemaVersion:1,converged:false})});await jobs.init();
  const {id}=await jobs.start(siliconBenchmark(),0);await jobs.active?.done;const info=await jobs.inspect(id);assert.equal(info.status.state,'failed');assert.equal(info.result,null);
  let launches=0;const closing=new PhysicsJobs({root,solve:()=>{launches++;throw Error('Must not launch.');}});const pending=closing.start(siliconBenchmark(),0);await closing.close();await assert.rejects(()=>pending,/退出/);assert.equal(launches,0);
});
