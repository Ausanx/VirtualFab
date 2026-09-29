import test from 'node:test';
import assert from 'node:assert/strict';
import { atomicTemplate,validateDft,dftSnapshot } from '../src/atomic.js';
import { createProject } from '../src/recipes.js';
import { validateProject } from '../src/engine.js';

test('atomic templates define physical cells independently of process geometry',()=>{
  for(const name of ['Si','MoS2']){
    const d=atomicTemplate(name);assert.equal(validateDft(d),d);
    assert.equal(d.structure.symbols.length,name==='Si'?2:3);
    assert.equal(d.structure.dimensionality,name==='Si'?3:2);
    assert.equal(d.settings.functional,'PBE');
  }
  const p=createProject('crossbar');validateProject(p);p.dft=atomicTemplate('Si');validateProject(p);
  assert.deepEqual(dftSnapshot({...p.dft,jobs:['00000000-0000-4000-8000-000000000000']}),dftSnapshot(p.dft));
});

test('invalid atomic input is rejected before launching a calculation',()=>{
  const invalid=[
    d=>d.structure.cellAngstrom.fill([0,0,0]),
    d=>d.structure.positionsAngstrom[0][0]=NaN,
    d=>d.structure.symbols[0]='Te',
    d=>d.settings.kDensity=0,
    d=>d.settings.kSampling=3,
    d=>d.settings.ecutrhoRy=10,
    d=>d.settings.functional='HSE',
    d=>d.jobs=['../other-job'],
  ];
  for(const mutate of invalid){const d=atomicTemplate('Si');mutate(d);assert.throws(()=>validateDft(d));}
  const d=atomicTemplate('MoS2');d.structure.cellAngstrom[2][0]=1;assert.throws(()=>validateDft(d));
});
test('2D validation respects the QE pseudopotential cutoff minimum cell height',()=>{
  const d=atomicTemplate('MoS2');d.structure.symbols=['Si'];d.structure.positionsAngstrom=[[0,0,5.15]];d.structure.cellAngstrom[2][2]=10.3;
  assert.throws(()=>validateDft(d),/真空/);
});
