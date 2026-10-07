export const equilibriumDefaults={material:'Si',temperatureK:300,acceptorCm3:1e16,donorCm3:1e16,pLengthUm:2,intrinsicLengthUm:0,nLengthUm:2,meshNm:10};
export function validateEquilibrium(c) {
  if(!c||c.material!=='Si'||c.temperatureK!==300)throw Error('平衡求解仅支持 300 K 体硅同质 PN/PIN 模型。');
  const ranges={acceptorCm3:[1e14,1e18],donorCm3:[1e14,1e18],pLengthUm:[.1,20],nLengthUm:[.1,20],intrinsicLengthUm:[0,20],meshNm:[2,100]};
  for(const [key,[min,max]]of Object.entries(ranges))if(typeof c[key]!=='number'||!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw Error(`${key} 应在 ${min}–${max} 内。`);
  if(c.intrinsicLengthUm>0&&c.intrinsicLengthUm*1000<4*c.meshNm)throw Error('i 区至少需要四个网格间距，请减小网格间距。');
  if((c.pLengthUm+c.nLengthUm+c.intrinsicLengthUm)*1000/c.meshNm>6000)throw Error('物理网格过大，请增大网格间距或缩短区域。');
  return c;
}

const number=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const text=(v,max)=>typeof v==='string'&&v.length<=max;
export function validateDevicePhysics(p) {
  if(p?.schemaVersion!==1||!text(p.geometry,200000)||!Number.isInteger(p.through)||p.through<0||p.through>149||!Array.isArray(p.regions)||p.regions.length>100)throw Error('区域物理配置无效。');
  const ids=new Set();
  for(const r of p.regions){
    if(!text(r?.id,100)||!r.id||ids.has(r.id)||!text(r.name,120))throw Error('物理区域名称或 ID 无效。');ids.add(r.id);
    validateBinding(r.binding);validateBox(r.box);
    if(!['nominal','activated','ionized','carrier'].includes(r.basis)||!['full','partial','unknown'].includes(r.ionization))throw Error('掺杂浓度或电离模型无效。');
    for(const key of ['donor','acceptor']){
      const d=r[key];
      if(!d||!['measured','derived','estimated','missing'].includes(d.evidence)||!(d.value===null||number(d.value,0,1e22))||(d.evidence==='missing')!==(d.value===null)||!text(d.source,2000)||!text(d.note,2000))throw Error('掺杂证据无效；未知浓度必须为 null。');
      if(d.evidence==='measured'&&(!d.source.trim()||!d.note.trim()))throw Error('实测掺杂需要来源与条件。');
      if(d.unit!==undefined&&d.unit!=='cm^-3')throw Error('体硅掺杂必须使用 cm^-3；面密度不能直接作为体密度。');
    }
    if(!(r.activation===null||number(r.activation,0,1))||!text(r.assumption,2000))throw Error('激活比例或模型假设无效。');
  }
  const path=p.path;
  if(!path||!['x','y','z'].includes(path.axis)||!['x','y','z'].every(k=>number(path[k],-3000,3000))||!number(path.startUm,-3000,3000)||!number(path.endUm,-3000,3000)||path.startUm===path.endUm||!number(path.meshNm,2,100))throw Error('一维路径或网格无效。');
  for(const key of ['start','end']){
    const b=path[key];if(!b||!['truncation','electrode'].includes(b.kind))throw Error('端部边界无效。');
    if(b.kind==='electrode')validateBinding(b.binding);
  }
  if(p.jobs!==undefined&&(!Array.isArray(p.jobs)||p.jobs.length>100||p.jobs.some(id=>typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))||new Set(p.jobs).size!==p.jobs.length))throw Error('平衡任务引用无效。');
  return p;
}
export function validateBox(b){
  if(!b||!['x','y','z'].every(k=>number(b[k+'0'],-3000,3000)&&number(b[k+'1'],-3000,3000)&&b[k+'0']<b[k+'1']))throw Error('空间区域需为非空长方体，单位 μm。');
}
function validateBinding(b){
  if(!b||!text(b.stepId,100)||!text(b.material,80)||!Array.isArray(b.anchor)||b.anchor.length!==3||!b.anchor.every(v=>number(v,-3000,3000))||!Number.isInteger(b.samples)||b.samples<1||b.samples>1000000)throw Error('空间绑定无效。');
  validateBox(b.box);
}

export function assessEquilibrium(r,config=r?.config){
  validateEquilibrium(config);
  if(r?.schemaVersion!==1||!r.converged||JSON.stringify(r.config)!==JSON.stringify(config)||!Array.isArray(r.rows)||r.rows.length<3||r.rows.length>15000||!Array.isArray(r.fields)||r.fields.length!==r.rows.length-1)throw Error('平衡结果不完整或与输入不符。');
  const q=1.602176634e-19,eps=11.7*8.8541878128e-14,vt=8.617333262145e-5*300,ni=Math.sqrt(2.8e19*1.04e19)*Math.exp(-1.12/(2*vt)),end=config.pLengthUm+config.intrinsicLengthUm+config.nLengthUm;
  let residual=0,carrierError=0,bandError=0,densityError=0;
  for(let j=0;j<r.rows.length;j++){
    const b=r.rows[j];
    if(!['xUm','potentialV','ecEv','evEv','efEv','electronCm3','holeCm3','netDopingCm3'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k]))||b.electronCm3<=0||b.holeCm3<=0||j>0&&b.xUm<=r.rows[j-1].xUm)throw Error('平衡节点包含无效数据。');
    carrierError=Math.max(carrierError,Math.abs(b.electronCm3*b.holeCm3/ni**2-1));
    bandError=Math.max(bandError,Math.abs(b.efEv),Math.abs(b.ecEv-b.evEv-1.12));
    densityError=Math.max(densityError,Math.abs(2.8e19*Math.exp(-b.ecEv/vt)/b.electronCm3-1),Math.abs(1.04e19*Math.exp(b.evEv/vt)/b.holeCm3-1));
    if(j>0&&j<r.rows.length-1){
      const a=r.rows[j-1],c=r.rows[j+1],h1=(b.xUm-a.xUm)*1e-4,h2=(c.xUm-b.xUm)*1e-4;
      const lap=2*((c.potentialV-b.potentialV)/h2-(b.potentialV-a.potentialV)/h1)/(h1+h2);
      residual=Math.max(residual,Math.abs(eps*lap+q*(b.holeCm3-b.electronCm3+b.netDopingCm3))/(q*Math.max(config.acceptorCm3,config.donorCm3)));
    }
  }
  if(Math.abs(r.rows[0].xUm)>1e-8||Math.abs(r.rows.at(-1).xUm-end)>1e-8||!r.fields.every((f,j)=>Number.isFinite(f.xUm)&&Number.isFinite(f.fieldVcm)&&Math.abs(f.xUm-(r.rows[j].xUm+r.rows[j+1].xUm)/2)<1e-8)||!r.meshCheck||!Number.isFinite(r.meshCheck.potentialDifferenceV)||!Number.isFinite(r.meshCheck.peakFieldRelativeDifference))throw Error('平衡结果坐标或精度数据不完整。');
  if(!Array.isArray(r.warnings)||!r.warnings.every(w=>typeof w==='string')||!Number.isFinite(r.builtInV)||!Number.isFinite(r.peakFieldVcm)||!r.oracle||!r.parameters||!Number.isFinite(r.oracle.builtInV)||!Number.isFinite(r.oracle.peakFieldVcm)||r.parameters.gapEv!==1.12||r.parameters.ncCm3!==2.8e19||r.parameters.nvCm3!==1.04e19||r.parameters.relativePermittivity!==11.7||Math.abs(r.parameters.niCm3/ni-1)>1e-8||!Number.isFinite(r.parameters.niCm3)||r.meshCheck.potentialDifferenceV<0||r.meshCheck.peakFieldRelativeDifference<0)throw Error('平衡结果摘要或模型参数不完整。');
  const builtinError=Math.abs(r.builtInV-vt*Math.log(config.acceptorCm3*config.donorCm3/ni**2));
  const check=(quantity,value,limit)=>({quantity,value,limit,state:value<=limit?'passed':'failed'});
  const validation={algorithm:[check('np/ni²',carrierError,1e-10),check('能带 / 态密度载流子关系',densityError,1e-10),check('EF 平直 / 恒定带隙 (eV)',bandError,1e-10),check('内建电势解析差 (V)',builtinError,1e-8)],numerical:[check('归一化 Poisson 残差',residual,1e-6),check('网格减半电势差 (V)',r.meshCheck.potentialDifferenceV,.002),check('网格减半峰值场相对差',r.meshCheck.peakFieldRelativeDifference,.02)],literature:{state:'unchecked'},experiment:{state:'unchecked'}};
  const fractionBoundary=(rows,key,doping,fraction,side)=>{
    if(side==='p'&&rows[0][key]<=doping*fraction)return {xUm:rows[0].xUm,touchesBoundary:true};
    if(side==='n'&&rows.at(-1)[key]<=doping*fraction)return {xUm:rows.at(-1).xUm,touchesBoundary:true};
    for(let j=1;j<rows.length;j++){
      const a=rows[j-1],b=rows[j],fa=a[key]/doping-fraction,fb=b[key]/doping-fraction;
      if(side==='p'?fa>0&&fb<=0:fa<=0&&fb>0)return {xUm:a.xUm+(b.xUm-a.xUm)*fa/(fa-fb),touchesBoundary:false};
    }
    return {xUm:null,touchesBoundary:false};
  };
  const lp=config.pLengthUm,li=config.intrinsicLengthUm;
  const depletion={definition:'p/n 区多数载流子浓度 ≤ fraction × 该区杂质浓度；线性插值边界。默认 fraction=0.5 是操作定义，非统一学术标准。未识别表示该阈值未形成边界。i 区只按几何计入跨度，不声称无移动电荷。',intrinsicLengthUm:li,thresholds:[.1,.5,.9].map(fraction=>{
    const p=fractionBoundary(r.rows.filter(row=>row.xUm<=lp+1e-9),'holeCm3',config.acceptorCm3,fraction,'p'),n=fractionBoundary(r.rows.filter(row=>row.xUm>=lp+li-1e-9),'electronCm3',config.donorCm3,fraction,'n');
    return {fraction,pBoundary:p,nBoundary:n,pWidthUm:p.xUm===null?null:lp-p.xUm,nWidthUm:n.xUm===null?null:n.xUm-lp-li,spanUm:p.xUm===null||n.xUm===null?null:n.xUm-p.xUm};
  })};
  return {...r,validation,depletion,accuracyPassed:[...validation.algorithm,...validation.numerical].every(c=>c.state==='passed')};
}
