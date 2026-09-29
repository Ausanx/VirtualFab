import test from 'node:test';
import assert from 'node:assert/strict';
import { materials } from '../src/materials.js';
import { bandAlignment,analyze } from '../src/physics.js';
import { validateProject,simulate,compareGrids,minimumFeature } from '../src/engine.js';
import { createLiteratureProject } from '../benchmarks/literature.mjs';
import { equilibriumDefaults,validateEquilibrium } from '../src/equilibrium.js';

const selection=[{a:'MoS2',b:'WSe2',profileId:'chiu2015-mos2-wse2',conditionsConfirmed:true}];
const material=id=>materials.find(m=>m.id===id);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('optical and unclassified gaps cannot silently enter electronic offsets or MS barriers',()=>{
  assert.equal(bandAlignment(material('MoS2'),material('WSe2')).type,'unknown');
  assert.match(bandAlignment(material('MoS2'),material('WSe2')).note,/光学/);
  const p=createLiteratureProject('radisavljevic2011');
  const ms=analyze(simulate(p),p.materials).structures.filter(s=>s.code==='MS'&&s.materials.includes('MoS2'));
  assert.ok(ms.length);assert.ok(ms.every(s=>s.evidence.every(t=>!t.includes('理想电子势垒'))));
  const legacy=structuredClone(material('Si'));delete legacy.bandGap.kind;
  assert.equal(bandAlignment(legacy,material('Si')).type,'unknown');
  const reference=structuredClone(material('Si'));reference.affinity.reference='unspecified';
  assert.equal(bandAlignment(reference,material('Si')).type,'unknown');
});

test('measured interface offsets are signed, separate from vacuum affinities and condition gated',()=>{
  const a=material('MoS2'),b=material('WSe2'),before=JSON.stringify([a,b]);
  const f=bandAlignment(a,b,selection,[.65,.7]),r=bandAlignment(b,a,selection,[.7,.65]);
  assert.equal(f.type,'II');assert.equal(f.reference,'relative-interface');
  close(f.deltaEc,.76);close(f.deltaEv,.83);close(r.deltaEc,-.76);close(r.deltaEv,-.83);
  close(f.gapA+f.deltaEc-f.deltaEv,f.gapB);
  assert.equal(f.deltaEcError,.12);assert.equal(f.deltaEvError,.07);
  assert.equal(JSON.stringify([a,b]),before);
  assert.equal(bandAlignment(a,b,[{...selection[0],conditionsConfirmed:false}],[.65,.7]).type,'unknown');
  assert.equal(bandAlignment(a,b,selection,[20,.7]).type,'unknown');
  assert.equal(bandAlignment(a,b,selection).type,'unknown');
});

test('real geometry with a spacer, mismatched thickness or no contact cannot adopt an interface profile',()=>{
  const p=createLiteratureProject('chiu2015');
  assert.equal(analyze(simulate(p),p.materials,p.interfaceSelections).interfaces[0].reference,'relative-interface');
  p.steps.find(s=>s.id==='n-flake').params.thicknessNm=10;
  assert.equal(analyze(simulate(p),p.materials,p.interfaceSelections).interfaces[0].type,'unknown');
  p.steps.find(s=>s.id==='n-flake').params.offsetXUm=20;
  assert.equal(analyze(simulate(p),p.materials,p.interfaceSelections).interfaces.length,0);
});

test('a nonuniform connected film cannot apply a single-layer interface profile using only its maximum thickness',()=>{
  const p=createLiteratureProject('chiu2015'),state=simulate(p);
  const cell=state.cells.find(c=>c.some(l=>l.material==='MoS2')&&c.some(l=>l.material==='WSe2'));
  const film=cell.find(l=>l.material==='MoS2');film.z1=film.z0+.3;
  assert.equal(analyze(state,p.materials,p.interfaceSelections).interfaces[0].type,'unknown');
});

test('energy metadata, interface choices and physical parameters survive validated v1 round trips',()=>{
  const p=createLiteratureProject('chiu2015');p.equilibrium=structuredClone(equilibriumDefaults);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))),p);
  const legacy=structuredClone(p);delete legacy.interfaceSelections;delete legacy.equilibrium;
  for(const m of legacy.materials){delete m.bandGap.kind;delete m.affinity.reference;}
  validateProject(legacy);
  for(const mutate of [
    p=>p.materials[0].bandGap.kind='invented',
    p=>p.materials[0].affinity.reference='HOPG',
    p=>p.interfaceSelections[0].profileId='missing',
    p=>p.interfaceSelections.push({...p.interfaceSelections[0],a:'WSe2',b:'MoS2'}),
    p=>p.equilibrium.temperatureK=77,
  ]){const bad=structuredClone(p);mutate(bad);assert.throws(()=>validateProject(bad));}
});

test('grid comparison preserves actual nonmonotonic sampling and project settings',()=>{
  const p=createLiteratureProject('lee2014');p.resolution=40;
  for(const s of p.steps)if('offsetXUm' in s.params)s.params.offsetXUm+=.137;
  const before=JSON.stringify(p),g=compareGrids(p);
  assert.deepEqual(g.map(r=>r.resolution),[20,40,80]);
  const area=g.map(r=>r.metrics.find(m=>m.stepId==='n-flake').areaUm2);
  assert.ok(new Set(area).size>1);assert.equal(JSON.stringify(p),before);
  assert.equal(minimumFeature({pattern:'contacts',widthUm:4,lengthUm:3.5,gapUm:1.5}),1);
  assert.equal(minimumFeature({pattern:'array-x',widthUm:4,lengthUm:20,pitchUm:4.1,count:2}),4.1-4);
  assert.equal(minimumFeature({pattern:'all',widthUm:.01,lengthUm:.01}),null);
});

test('underresolved transferred films and narrow contact gaps produce geometry warnings',()=>{
  const p=createLiteratureProject('radisavljevic2011');p.resolution=8;
  p.steps.find(s=>s.id==='channel').params.widthUm=.05;
  const s=simulate(p);
  assert.ok(s.diagnostics.some(d=>d.code==='EMPTY_TRANSFER'));
  assert.ok(s.diagnostics.some(d=>d.code==='SUBGRID'&&d.stepId==='channel'));
});

test('equilibrium input rejects heterojunctions, temperature extrapolation and underresolved i layers',()=>{
  validateEquilibrium(equilibriumDefaults);
  for(const bad of [
    {material:'MoS2'},{temperatureK:77},{acceptorCm3:1e20},{donorCm3:NaN},
    {intrinsicLengthUm:.001},{meshNm:1},{pLengthUm:20,nLengthUm:20,intrinsicLengthUm:20,meshNm:2},
  ])assert.throws(()=>validateEquilibrium({...equilibriumDefaults,...bad}));
});
