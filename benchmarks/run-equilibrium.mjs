import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {solveEquilibrium} from '../solver/run.mjs';
import {equilibriumDefaults} from '../src/equilibrium.js';

const output=new URL('../artifacts/equilibrium/',import.meta.url);
await mkdir(output,{recursive:true});
const configurations=[
  ['pn-symmetric',{}],
  ['pn-low-doping',{acceptorCm3:1e15,donorCm3:1e15}],
  ['pn-asymmetric',{acceptorCm3:1e15,donorCm3:1e17,meshNm:2}],
  ['pin',{intrinsicLengthUm:1}],
  ['pn-short-contacts',{pLengthUm:.1,nLengthUm:.1}],
  ['pn-underresolved',{acceptorCm3:1e15,donorCm3:1e17,meshNm:100}],
];
const report=[];
for(const [name,values]of configurations){
  const r=await solveEquilibrium({...equilibriumDefaults,...values},{python:process.argv.includes('--python')});
  const vt=8.617333262145e-5*300,ni=r.parameters.niCm3,nc=r.parameters.ncCm3,nv=r.parameters.nvCm3;
  assert.ok(r.converged);
  assert.ok(Math.abs(r.builtInV-vt*Math.log(r.config.acceptorCm3*r.config.donorCm3/ni**2))<1e-8);
  let maxMassActionError=0,maxBandDensityError=0,maxPoissonResidual=0;
  for(const row of r.rows){
    for(const key of ['potentialV','ecEv','evEv','efEv','electronCm3','holeCm3','netDopingCm3'])assert.ok(Number.isFinite(row[key]));
    assert.equal(row.efEv,0);
    assert.ok(Math.abs(row.ecEv-row.evEv-1.12)<1e-12);
    maxMassActionError=Math.max(maxMassActionError,Math.abs(row.electronCm3*row.holeCm3/ni**2-1));
    maxBandDensityError=Math.max(maxBandDensityError,Math.abs(nc*Math.exp(-row.ecEv/vt)/row.electronCm3-1),Math.abs(nv*Math.exp(row.evEv/vt)/row.holeCm3-1));
  }
  const eps=11.7*8.8541878128e-14,q=1.602176634e-19;
  for(let j=1;j<r.rows.length-1;j++){
    const a=r.rows[j-1],b=r.rows[j],c=r.rows[j+1],h1=(b.xUm-a.xUm)*1e-4,h2=(c.xUm-b.xUm)*1e-4;
    const laplacian=2*((c.potentialV-b.potentialV)/h2-(b.potentialV-a.potentialV)/h1)/(h1+h2);
    const residual=eps*laplacian+q*(b.holeCm3-b.electronCm3+b.netDopingCm3);
    maxPoissonResidual=Math.max(maxPoissonResidual,Math.abs(residual)/(q*Math.max(r.config.acceptorCm3,r.config.donorCm3)));
  }
  assert.ok(maxMassActionError<1e-12);assert.ok(maxBandDensityError<1e-12);
  assert.ok(maxPoissonResidual<1e-6,`${name} normalized Poisson residual ${maxPoissonResidual}`);
  let poissonBoltzmannPeakFieldVcm=null;
  if(!r.config.intrinsicLengthUm){
    // First integral of the continuum Poisson/Boltzmann equation, with neutral contacts at infinity.
    const na=r.config.acceptorCm3,nd=r.config.donorCm3;
    const pp=-vt*Math.asinh(na/(2*ni)),pn=vt*Math.asinh(nd/(2*ni));
    const f=(psi,d)=>2*ni*vt*Math.cosh(psi/vt)-d*psi;
    const pj=(f(pp,-na)-f(pn,nd))/(na+nd);
    poissonBoltzmannPeakFieldVcm=Math.sqrt(2*q/eps*(f(pj,-na)-f(pp,-na)));
  }
  if(name==='pn-short-contacts')assert.ok(!r.oracle.remoteContactsValid&&r.warnings.length);
  else if(name==='pn-underresolved')assert.ok(!r.meshCheck.withinTolerance&&r.warnings.length);
  else{
    assert.ok(r.oracle.remoteContactsValid);
    assert.ok(r.meshCheck.withinTolerance,`${name}: ${JSON.stringify(r.meshCheck)}`);
    if(poissonBoltzmannPeakFieldVcm!==null)assert.ok(Math.abs(r.peakFieldVcm/poissonBoltzmannPeakFieldVcm-1)<.03,`${name}: continuum first-integral mismatch`);
    // PIN uses a depletion approximation, which omits mobile charge.
    else assert.ok(Math.abs(r.peakFieldVcm/r.oracle.peakFieldVcm-1)<.15);
  }
  const fields=['xUm','potentialV','ecEv','evEv','efEv','electronCm3','holeCm3','netDopingCm3'];
  await writeFile(new URL(name+'.csv',output),[fields.join(','),...r.rows.map(row=>fields.map(k=>row[k]).join(','))].join('\n')+'\n');
  await writeFile(new URL(name+'-field.csv',output),'xUm,fieldVcm\n'+r.fields.map(f=>`${f.xUm},${f.fieldVcm}`).join('\n')+'\n');
  await writeFile(new URL(name+'.json',output),JSON.stringify(r,null,2)+'\n');
  report.push({name,config:r.config,builtInV:r.builtInV,analyticBuiltInV:r.oracle.builtInV,peakFieldVcm:r.peakFieldVcm,analyticPeakFieldVcm:r.oracle.peakFieldVcm,poissonBoltzmannPeakFieldVcm,meshCheck:r.meshCheck,maxMassActionError,maxBandDensityError,maxPoissonResidual,warnings:r.warnings});
}
await writeFile(new URL('summary.json',output),JSON.stringify(report,null,2)+'\n');
const doc=`# PN/PIN 平衡求解验证

由 \`npm run validate:physics\` 生成。DEVSIM 2.11.0 有限体积 Poisson/Boltzmann 解；独立 1D 体硅、300 K、完全电离、零偏压、理想欧姆端部。不是原子层异质结或当前三维工艺的性能预测。

| 算例 | Vbi 数值 / V | Vbi 解析 / V | 峰值场数值 / V cm⁻¹ | 耗尽近似 / V cm⁻¹ | 连续 P–B 一阶积分 / V cm⁻¹ | 网格减半 Δψ / mV | 归一化 Poisson 残差 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${report.map(r=>`| ${r.name} | ${r.builtInV.toFixed(6)} | ${r.analyticBuiltInV.toFixed(6)} | ${r.peakFieldVcm.toFixed(2)} | ${r.analyticPeakFieldVcm.toFixed(2)} | ${r.poissonBoltzmannPeakFieldVcm?.toFixed(2)||'不适用'} | ${(1000*r.meshCheck.potentialDifferenceV).toFixed(4)} | ${r.maxPoissonResidual.toExponential(2)} |`).join('\n')}

通过检查：平直 EF；带隙恒定；n p = ni²；能带与态密度给出的载流子一致；离散 Poisson 残差小于 10⁻⁶（以 q max(NA,ND) 归一化）；数值与解析 Vbi 差小于 10⁻⁸ V。三个正常 PN 算例峰值场与连续 Poisson–Boltzmann 一阶积分的差小于 3%。PIN 的耗尽近似方法比较阈值为 15%。这些是数学模型比较阈值，不是实验拟合误差。

三个正常 PN 与 PIN 的网格减半 Δψ ≤ 2 mV、峰值场变化 ≤ 2%。短接触与粗网格为负对照，不能计作精度通过；短接触须出现远端中性条件警告，粗网格须出现精度警告。小离散残差本身不能证明网格足够精细。

模型选用 Eg = 1.12 eV、Nc = 2.8×10¹⁹、Nv = 1.04×10¹⁹ cm⁻³、εr = 11.7；ni = sqrt(Nc Nv) exp(−Eg/2kT) = 6.676×10⁹ cm⁻³。它们是该算例的模型参数，不是对用户制备的样品测量。温度暂限于 300 K，不外推参数。

不对称 PN 的耗尽近似忽略接面附近移动电荷，峰值场偏差约 38%，不能强行使用 15% 阈值作精确标定。保留这项差异，并用同一 Poisson/Boltzmann 方程的连续一阶积分独立核对。定义 F(ψ,D) = 2 ni VT cosh(ψ/VT) − Dψ，两侧中性电势 ψp = −VT asinh(NA/2ni)、ψn = VT asinh(ND/2ni)；连续场条件给出 ψj = [F(ψp,−NA) − F(ψn,ND)]/(NA+ND)，峰值场为 sqrt(2q/ε × [F(ψj,−NA) − F(ψp,−NA)])。该无限体比较仅在端部远离空间电荷区时使用。

PIN 的 i 区是本征硅，耗尽近似假定 i 区无移动电荷；数值解保留移动电荷。其解析式为 Vbi = q/(2ε) × S²(1/NA+1/ND) + q/ε × S Li，其中 S = NA xp = ND xn。

源数据与各算例参数：\`artifacts/equilibrium/*.json\`，节点及电场 CSV 同目录。

来源：[DEVSIM 官方模型](https://github.com/devsim/devsim/blob/main/python_packages/simple_physics.py)、[MIT 6.012 Lecture 5](https://ocw.mit.edu/courses/6-012-microelectronic-devices-and-circuits-spring-2009/ac6a8e55da0ad6e1f7dedc37d86b6a75_MIT6_012S09_lec05.pdf)、[TU Wien TCAD 模型参数](https://www.iue.tuwien.ac.at/pdf/ib_2018/BC2018_Sverdlov_1.pdf)、[热平衡载流子关系](https://www.iue.tuwien.ac.at/phd/rzepa/)。这是解析交叉验证和守恒检查，尚不是独立实验标定。
`;
await writeFile(new URL('../docs/validation/equilibrium-results.md',import.meta.url),doc);
console.log(`Equilibrium validation passed: ${report.length} cases, analytic built-in potential, mass action, band/DOS consistency, finite-volume Poisson residual, mesh refinement, short-contact and underresolved-mesh negative controls.`);
