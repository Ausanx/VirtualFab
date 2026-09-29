// Interface offsets belong to a sample, not to a universal electron affinity.
export const interfaceProfiles = [{
  id:'chiu2015-mos2-wse2', name:'Chiu 2015 · 单层 MoS₂ / WSe₂', a:'MoS2', b:'WSe2',
  gapA:2.15, gapB:2.08, gapKind:'quasiparticle',
  deltaEc:{value:.76,uncertainty:.12,evidence:'derived'},
  deltaEv:{value:.83,uncertainty:.07,evidence:'measured'},
  thicknessNm:[.5,.9],
  source:'https://doi.org/10.1038/ncomms8666',
  conditions:'单层 CVD TMD；XPS 叠层位于约 2 nm 原生氧化层的 Si 上，300 °C 高真空退火超过 8 h；STS 单层位于 HOPG，77 K。需核实样品与方法条件。',
  note:'VBO 由 XPS/STS 校正；CBO 由 VBO 和 STS 准粒子带隙推导，两项误差并非独立。相对图以第一种材料的价带顶为零，不提供绝对真空带边。',
}];

export const interfaceKey = (a,b) => JSON.stringify([a,b].sort());
export const profilesFor = (a,b) => interfaceProfiles.filter(p=>interfaceKey(p.a,p.b)===interfaceKey(a,b));
export function selectedProfile(a,b,selections=[],thicknesses=[]) {
  const selection=selections.find(s=>interfaceKey(s.a,s.b)===interfaceKey(a,b));
  if(!selection)return null;
  const p=profilesFor(a,b).find(p=>p.id===selection.profileId);
  if(!p)return {type:'unknown',note:'界面档案不存在或材料组合不匹配。'};
  if(!selection.conditionsConfirmed)return {type:'unknown',profileId:p.id,note:'尚未确认界面档案的样品与测量条件。'};
  if(thicknesses.length!==2||thicknesses.some(t=>{
    const values=Array.isArray(t)?t:[t];
    return !values.length||values.some(v=>!Number.isFinite(v)||v<p.thicknessNm[0]||v>p.thicknessNm[1]);
  }))
    return {type:'unknown',profileId:p.id,note:'该界面档案仅适用于单层；当前实际接触区域膜厚不在 0.5–0.9 nm 范围内。'};
  const forward=a===p.a,sign=forward?1:-1,gapA=forward?p.gapA:p.gapB,gapB=forward?p.gapB:p.gapA;
  return {profileId:p.id,profileName:p.name,reference:'relative-interface',gapA,gapB,
    deltaEc:sign*p.deltaEc.value,deltaEv:sign*p.deltaEv.value,
    deltaEcError:p.deltaEc.uncertainty,deltaEvError:p.deltaEv.uncertainty,
    source:p.source,conditions:p.conditions,note:p.note,estimated:false};
}
