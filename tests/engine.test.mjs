import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, validateProject } from '../src/engine.js';
import { analyze, bandAlignment, diodeCurve } from '../src/physics.js';
import { materials } from '../src/materials.js';
import { createProject, step } from '../src/recipes.js';

const project = steps => ({ version: 1, name: '测试', sizeUm: 40, resolution: 40, materials: structuredClone(materials), steps });
const substrate = () => step('substrate');
const deposit = (material, doping='unknown') => step('deposit', { material, doping, thicknessNm: 20 });
const codes = p => analyze(simulate(p), p.materials).structures.map(s => s.code);

test('lift-off removes resist-supported metal while retaining metal in developed openings', () => {
  const p = project([substrate(), step('coat'), step('bake'), step('expose', { pattern: 'stripe-x', widthUm: 6, lengthUm:40 }), step('bake'), step('develop'), deposit('Au')]);
  const before = simulate(p);
  assert.equal(before.cells.filter(c=>c.some(l=>l.material==='Au')).length,1600);
  p.steps.push(step('liftoff'));
  const after = simulate(p);
  assert.equal(after.cells.some(c=>c.some(l=>l.material==='NR9-3000PY')),false);
  const gold = after.cells.filter(c=>c.some(l=>l.material==='Au'));
  assert.equal(gold.length,240);
  assert.ok(gold.every(c=>c.at(-1).z0===0));
});

test('negative resist exposure reverses the optical mask to obtain the requested opening', () => {
  const p = project([substrate(), step('coat'), step('bake'), step('expose',{pattern:'rect',widthUm:8,lengthUm:8})]);
  const s=simulate(p);
  assert.equal(s.cells.filter(c=>c.at(-1).exposed===false).length,64);
  p.steps.push(step('bake'),step('develop'));
  assert.equal(simulate(p).cells.filter(c=>!c.some(l=>l.material==='NR9-3000PY')).length,64);
});

test('NR9 requires post-exposure bake before development', () => {
  const p=project([substrate(),step('coat'),step('bake',{temperatureC:150}),step('expose'),step('develop')]);
  assert.equal(simulate(p).stoppedAt,4);
  p.steps.splice(4,0,step('bake',{temperatureC:100}));
  assert.equal(simulate(p).stoppedAt,null);
});

test('a zero-duration bake cannot satisfy NR9 post-exposure baking', () => {
  const p=project([substrate(),step('coat'),step('bake',{temperatureC:150}),step('expose'),step('bake',{temperatureC:25,durationS:0}),step('develop')]);
  assert.equal(simulate(p).stoppedAt,4);
  p.steps[4].params.durationS=1;
  const unverified=simulate(p);
  assert.equal(unverified.stoppedAt,null);
  assert.ok(unverified.diagnostics.some(d=>d.code==='NR9_PEB_UNVERIFIED'));
  p.steps[4].params={temperatureC:100,durationS:60};
  assert.ok(!simulate(p).diagnostics.some(d=>d.code==='NR9_PEB_UNVERIFIED'));
  p.steps[4].params.durationS=120;
  assert.ok(simulate(p).diagnostics.some(d=>d.code==='NR9_PEB_UNVERIFIED'));
  p.steps[4].params.durationS=60;
  p.steps.splice(5,0,step('expose'));
  assert.equal(simulate(p).stoppedAt,6,'a new exposure requires a subsequent post-exposure bake');
});

test('NR9 bake reference conditions account for glass substrates', () => {
  const p=project([step('substrate',{material:'glass',oxideNm:0}),step('coat'),step('bake',{temperatureC:150,durationS:60}),step('expose'),step('bake',{temperatureC:100,durationS:60}),step('develop')]);
  const warnings=simulate(p).diagnostics.map(d=>d.code);
  assert.ok(warnings.includes('NR9_SOFTBAKE_UNVERIFIED'));
  assert.ok(warnings.includes('NR9_PEB_UNVERIFIED'));
  p.steps[2].params.durationS=210;p.steps[4].params.durationS=210;
  const calibrated=simulate(p).diagnostics.map(d=>d.code);
  assert.ok(!calibrated.includes('NR9_SOFTBAKE_UNVERIFIED'));
  assert.ok(!calibrated.includes('NR9_PEB_UNVERIFIED'));
});

test('successive exposures accumulate on the same resist layer', () => {
  const exposures=[step('expose',{pattern:'rect',widthUm:4,lengthUm:4,offsetXUm:-10}),step('expose',{pattern:'rect',widthUm:4,lengthUm:4,offsetXUm:10})];
  const positive=project([substrate(),step('coat',{material:'S1813'}),step('bake'),...exposures,step('develop')]);
  const positiveState=simulate(positive);
  assert.equal(positiveState.stoppedAt,null);
  assert.equal(positiveState.cells.filter(c=>!c.some(l=>l.material==='S1813')).length,32);
  const negative=project([substrate(),step('coat'),step('bake'),...exposures,step('bake',{temperatureC:100}),step('develop')]);
  assert.equal(simulate(negative).cells.filter(c=>!c.some(l=>l.material==='NR9-3000PY')).length,0);
});

test('AZ 5214E uses positive mode until image-reversal steps are modeled', () => {
  const az=materials.find(m=>m.id==='AZ5214E');
  assert.equal(az.tone,'positive');
});

test('non-directional deposition does not silently promise reliable lift-off', () => {
  const p=project([substrate(),step('coat'),step('bake'),step('expose'),step('bake'),step('develop'),step('deposit',{method:'ALD'}),step('liftoff')]);
  assert.ok(simulate(p).diagnostics.some(d=>d.code==='LIFTOFF_CONFORMAL'));
});

test('etch consumes exposed target only; an unetched covering dielectric blocks it', () => {
  const p=project([substrate(),deposit('Te','p'),deposit('Al2O3'),step('etch',{material:'Te',durationS:30,rateNmS:2})]);
  const s=simulate(p);
  assert.ok(s.cells.every(c=>c.find(l=>l.material==='Te').z1-c.find(l=>l.material==='Te').z0===20));
  p.steps.splice(2,1);
  assert.equal(simulate(p).cells.some(c=>c.some(l=>l.material==='Te')),false);
});

test('PN and PIN recognition uses actual direct contacts and treats insulators separately', () => {
  assert.ok(codes(project([substrate(),deposit('Te','p'),deposit('InON','n')])).includes('PN'));
  assert.ok(codes(project([substrate(),deposit('Te','p'),deposit('Si','i'),deposit('InON','n')])).includes('PIN'));
  const c=codes(project([substrate(),deposit('Te','p'),deposit('Al2O3'),deposit('InON','n')]));
  assert.ok(c.includes('SIS'));
  assert.ok(!c.includes('PN') && !c.includes('PIN'));
});

test('MIM does not assert memory behavior; missing band information stays missing', () => {
  const p=project([substrate(),deposit('Au'),deposit('HfO2'),deposit('Pt')]);
  const result=analyze(simulate(p),p.materials);
  assert.ok(result.structures.some(s=>s.code==='MIM'));
  assert.ok(!result.structures.some(s=>s.code==='MEMORY'));
  assert.equal(bandAlignment(materials.find(m=>m.id==='InON'),materials.find(m=>m.id==='Te')).type,'unknown');
});

test('band offsets distinguish nested, staggered and broken gaps independently of polarity', () => {
  const band=(gap,affinity)=>({bandGap:{value:gap,evidence:'estimated'},affinity:{value:affinity,evidence:'estimated'}});
  assert.equal(bandAlignment(band(3,3),band(1,4)).type,'I');
  assert.equal(bandAlignment(band(2,3),band(2,4)).type,'II');
  assert.equal(bandAlignment(band(1,3),band(1,5)).type,'III');
  assert.equal(bandAlignment(band(2,3),band(2,4)).estimated,true);
});

test('all process templates run and top/bottom gate templates have valid FET topology', () => {
  for(const template of ['crossbar','backgate','topgate','pn']) {
    const p=createProject(template);
    validateProject(p);
    const s=simulate(p);
    assert.ok(!s.diagnostics.some(d=>d.severity==='error'),`${template}: ${JSON.stringify(s.diagnostics)}`);
    if(template.includes('gate')) assert.ok(analyze(s,p.materials).structures.some(x=>x.code==='FET'),template);
    if(template==='crossbar') assert.ok(analyze(s,p.materials).structures.some(x=>x.code==='MIM'));
  }
});

test('FET terminals remain distinct across multilayer conductive paths', () => {
  const p=createProject('backgate');
  const s=simulate(p);
  for(const c of s.cells) {
    const z=c.at(-1).z1;
    c.push({material:'Ti',z0:z,z1:z+100,stepId:'bridge',role:'electrode',doping:'unknown'});
  }
  assert.ok(!analyze(s,p.materials).structures.some(x=>x.code==='FET'),'a Ti bridge shorts Au source and drain');
});

test('a sidewall short in top-surface deposition invalidates independent MIM terminals', () => {
  const p=createProject('crossbar');
  p.steps.find(s=>s.type==='deposit'&&s.params.material==='Pt').params.thicknessNm=40;
  const result=analyze(simulate(p),p.materials);
  assert.ok(!result.structures.some(s=>s.code==='MIM'));
  assert.ok(result.structures.some(s=>s.code==='SHORT'));
});

test('dual gates must share one connected channel, not merely a deposition step', () => {
  const layer=(material,z0,z1,stepId,role='none',doping='unknown')=>({material,z0,z1,stepId,role,doping});
  const bottom=[layer('Si',-30,-10,'bottom','gate','p'),layer('SiO2',-10,0,'oxide'),layer('MoS2',0,5,'channel','channel','n')];
  const top=[layer('MoS2',0,5,'channel','channel','n'),layer('Al2O3',5,10,'oxide2'),layer('Al',10,20,'top','gate')];
  const cells=Array.from({length:64},()=>[]);
  for(const [offset,stack] of [[0,bottom],[5,top]]) {
    cells[offset]=[layer('Au',0,5,'sd','source')];
    cells[offset+1]=stack;
    cells[offset+2]=[layer('Au',0,5,'sd','drain')];
  }
  const separate=analyze({resolution:8,cells},materials);
  assert.equal(separate.structures.filter(s=>s.code==='FET').length,2);
  assert.ok(!separate.structures.some(s=>s.code==='DUAL_GATE'));
  cells[1]=[...bottom,...top.slice(1)];
  const shared=analyze({resolution:8,cells},materials);
  assert.ok(shared.structures.some(s=>s.code==='DUAL_GATE'));
});

test('replaying and JSON round trip are deterministic and do not mutate input', () => {
  const p=createProject('crossbar'), copy=JSON.stringify(p);
  assert.deepEqual(simulate(p,5),simulate(JSON.parse(copy),5));
  assert.equal(JSON.stringify(p),copy);
});

test('invalid imports, duplicate ids and invalid numbers fail before simulation', () => {
  const p=createProject('crossbar');
  assert.throws(()=>validateProject({...p,resolution:10000}));
  assert.throws(()=>validateProject({...p,steps:[p.steps[0],p.steps[0]]}));
  assert.throws(()=>validateProject({...p,steps:[substrate(),deposit('does-not-exist')]}));
  assert.throws(()=>validateProject({...p,steps:[substrate(),step('deposit',{thicknessNm:-1})]}));
  p.materials[0].bandGap={value:1.12,evidence:'measured',source:' ',note:' '};
  assert.throws(()=>validateProject(p),/来源和测量条件/);
});

test('liftoff without developed openings and develop without exposure report errors', () => {
  assert.ok(simulate(project([substrate(),step('develop')])).diagnostics.some(x=>x.severity==='error'));
  assert.ok(simulate(project([substrate(),step('coat'),deposit('Au'),step('liftoff')])).diagnostics.some(x=>x.severity==='error'));
});

test('Shockley example reports chosen model parameters and remains finite', () => {
  const rows=diodeCurve({saturationA:1e-12,ideality:1.5,temperatureK:300,minV:-1,maxV:1,photocurrentA:0});
  assert.equal(rows.length,101);
  assert.ok(rows.every(p=>Number.isFinite(p.currentA)));
  assert.ok(Math.abs(rows[50].currentA)<1e-20);
  assert.throws(()=>diodeCurve({saturationA:-1,ideality:1,temperatureK:0,minV:0,maxV:1,photocurrentA:0}));
  assert.throws(()=>diodeCurve({saturationA:1e-12,ideality:.1,temperatureK:1,minV:-.5,maxV:.5,photocurrentA:0}),/数值范围/);
});
