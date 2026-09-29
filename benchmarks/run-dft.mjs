import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DftJobs,wslPath } from '../dft/jobs.mjs';
import { atomicTemplate } from '../src/atomic.js';

const root=path.resolve('artifacts/dft-benchmarks');await mkdir(root,{recursive:true});
const jobs=new DftJobs({root});await jobs.init();
const results=[],indexFile=path.join(root,'index.json');
let previous={};try{previous=JSON.parse(await readFile(indexFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
try{
  for(const name of ['Si','MoS2']){
    let job;
    if(process.argv.includes('--resume')&&previous[name]){
      job={id:previous[name]};const info=await jobs.inspect(job.id);
      if(info.status.state!=='completed')await jobs.resume(job.id);
    }else{job=await jobs.start(atomicTemplate(name));previous[name]=job.id;await writeFile(indexFile,JSON.stringify(previous,null,2));}
    console.log(`${name}: real QE job ${job.id}`);let stage='';
    for(;;){
      const info=await jobs.inspect(job.id),current=`${info.progress?.case||''} ${info.progress?.stage||''}`;
      if(stage!==current){stage=current;console.log(`${name}: ${current.trim()}`);}
      if(['failed','canceled','interrupted'].includes(info.status.state))throw Error(info.status.message);
      if(info.status.state==='completed'){
        const r=info.result,gap=r.baseline.sampledGapEv;
        assert.ok(gap>(name==='Si'?0.3:1.3)&&gap<(name==='Si'?0.9:2.3),`${name} broad PBE gap smoke check failed: ${gap}`);
        assert.equal(r.cases.length,name==='Si'?4:5);assert.ok(r.cases.every(c=>c.scfConverged));
        assert.ok(r.baseline.bands.energiesEv.length>=61);
        assert.equal(r.baseline.gapKind,'kohn-sham-sampled');
        const sameK=r.baseline.vbmKpoint.every((v,i)=>Math.abs(v-r.baseline.cbmKpoint[i])<1e-6);
        assert.equal(sameK,name==='MoS2',`${name}: unexpected sampled direct/indirect character`);
        const {stdout}=await promisify(execFile)('wsl.exe',['-d','VirtualFab-QE','-u','root','--exec','python3',wslPath(path.resolve('benchmarks/verify-dft.py')),wslPath(path.join(root,job.id))],{windowsHide:true,timeout:60000});
        const parserChecks=JSON.parse(stdout);await writeFile(path.join(root,job.id,'parser-crosscheck.json'),JSON.stringify(parserChecks,null,2));
        results.push({name,id:job.id,result:r,parserChecks});console.log(`${name}: gap ${gap.toFixed(6)} eV, sensitivity ${r.sensitivity.allWithinTolerance?'within tolerance':'requires refinement'}, ASE text/XML cross-check passed`);break;
      }
      await delay(2500);
    }
  }
}finally{await jobs.close();}
const rows=results.map(({name,id,result:r})=>`| ${name} | ${r.baseline.totalEnergyEv.toFixed(6)} | ${r.baseline.sampledGapEv.toFixed(6)} | ${r.cases.length} | ${r.sensitivity.allWithinTolerance?'within configured tolerance':'requires refinement'} | ${id} |`);
const checks=results.flatMap(({name,result:r})=>r.sensitivity.checks.map(c=>`| ${name} | ${c.name} | ${c.energyDifferenceMevAtom.toFixed(6)} | ${c.gapDifferenceEv.toFixed(6)} | ${c.withinTolerance?'pass':'refine'} |`));
const parserRows=results.flatMap(({name,parserChecks})=>parserChecks.map(c=>`| ${name} | ${c.case} | ${c.energyDeltaEv.toExponential(3)} | ${c.gapDeltaEv.toExponential(3)} | pass |`));
const report=`# Real QE DFT Validation\n\nRun: ${new Date().toISOString()}. Engine: ${results[0].result.backend.engine}; ASE ${results[0].result.backend.aseVersion}. All values below came from real local QE processes.\n\n| Structure | Total energy (eV/cell) | Uniform-grid sampled KS gap (eV) | Cases | Sensitivity | Job ID |\n|---|---:|---:|---:|---|---|\n${rows.join('\n')}\n\n| Structure | Scan | Energy difference (meV/atom) | Sampled gap difference (eV) | Current tolerance |\n|---|---|---:|---:|---|\n${checks.join('\n')}\n\nBaseline: fixed unrelaxed Si a=5.43 A; 1H MoS2 a=3.18 A, S-S thickness=3.19 A, cell Z=23.19 A. PBE scalar-relativistic USPP, no SOC, neutral/nonmagnetic, 60/480 Ry, density mesh 6, sampling mesh 12; offsets zero, conv_thr=1e-8 Ry. Separate scans: 80/640 Ry, density mesh 12, sampling mesh 18, and MoS2 cell Z +5 A with the slab recentered.\n\nThese are numerical smoke and one-increment sensitivity tests. Broad gap ranges (Si 0.3-0.9 eV, MoS2 1.3-2.3 eV) and sampled indirect/direct character are sanity gates, not fitted literature residuals or independent-code cross-validation. Even passing sensitivity is not proof of asymptotic convergence, physical stability or experiment agreement. The sampled gap can miss extrema between grid points; path energies are plotted separately. No vacuum reference, optical/quasiparticle gap, interface offset or device transport is derived.\n\nRaw evidence: artifacts/dft-benchmarks/<job-id>/{manifest.json,snapshot.json,pseudo,adapter,attempts,checkpoints,result.json,sensitivity.csv}. Per-case QE inputs, logs, XML and band CSV are hashed. GUI regression and packaged-app checks are recorded separately.\n`;
await mkdir('docs/validation',{recursive:true});await writeFile('docs/validation/dft-results.md',report);
await writeFile('docs/validation/dft-results.md',`\n## Independent Parser Checks\n\nQE XML energy and sampled gap were compared with ASE's espresso-out parser for every case. This checks extraction and unit conversion from the same QE calculation; it is not an independent electronic-structure engine. The energy tolerance includes the different CODATA constants used by ASE's two readers; gap agreement must be within 0.0002 eV (the text output is rounded).\n\n| Structure | Case | Energy difference (eV/cell) | Gap difference (eV) | Check |\n|---|---|---:|---:|---|\n${parserRows.join('\n')}\n\nMethod and primary references: [DFT method](dft-method.md).\n`,{flag:'a'});
console.log('Real DFT validation complete; see docs/validation/dft-results.md.');
