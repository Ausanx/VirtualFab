import { isConductor,getMaterial,bandDataIssue } from './materials.js';
import { contactGraph } from './engine.js';
import { selectedProfile,interfaceKey } from './interfaces.js';

const known=v=>v?.value!==null&&Number.isFinite(v?.value);
function alignmentType(ca,va,cb,vb) {
  if(ca<vb||cb<va)return 'III';
  if((ca<=cb&&va>=vb)||(cb<=ca&&vb>=va))return 'I';
  return 'II';
}
export function alignmentFromEdges(a,b) {
  return {type:alignmentType(a.ec,a.ev,b.ec,b.ev),deltaEc:b.ec-a.ec,deltaEv:b.ev-a.ev};
}
export function bandAlignment(a,b,selection=[],thicknesses=[]) {
  const profile=selectedProfile(a?.id,b?.id,selection,thicknesses);
  if(profile){if(profile.type==='unknown')return profile;return {...profile,type:alignmentType(profile.gapA,0,profile.gapA+profile.deltaEc,profile.deltaEv)};}
  const issue=bandDataIssue(a)||bandDataIssue(b);
  if(issue)return {type:'unknown',note:issue+'，未计算定量带阶。'};
  const ca=-a.affinity.value,va=ca-a.bandGap.value,cb=-b.affinity.value,vb=cb-b.bandGap.value;
  const uncertainty=[a.bandGap,a.affinity,b.bandGap,b.affinity].some(v=>v.evidence==='estimated');
  return {type:alignmentType(ca,va,cb,vb),deltaEc:cb-ca,deltaEv:vb-va,reference:'vacuum',estimated:uncertainty,note:'真空能级对齐近似；不含界面偶极、钉扎与自洽电荷重排。'};
}
export function analyze(state,materials,selections=[]) {
  const graph=contactGraph(state),nodeById=new Map(graph.nodes.map(n=>[n.id,n])),neighbors=new Map(graph.nodes.map(n=>[n.id,new Set()]));
  graph.edges.forEach(([a,b])=>{neighbors.get(a).add(b);neighbors.get(b).add(a);});
  const mat=n=>getMaterial(materials,n.material),sem=n=>mat(n)?.category==='semiconductor'&&n.role!=='support'&&n.role!=='gate';
  const metal=n=>isConductor(mat(n))||n.role==='gate',ins=n=>mat(n)?.category==='dielectric';
  const conductorNet=new Map();
  for(const n of graph.nodes.filter(metal)) {
    if(conductorNet.has(n.id))continue;
    const pending=[n.id];conductorNet.set(n.id,n.id);
    while(pending.length)for(const id of neighbors.get(pending.pop())) {
      if(metal(nodeById.get(id))&&!conductorNet.has(id)){conductorNet.set(id,n.id);pending.push(id);}
    }
  }
  const structures=[],seen=new Set(),interfaces=[],interfaceKeys=new Set();
  function add(code,title,nodes,evidence,missing=[]) {
    const key=code+':'+nodes.map(n=>code==='FET'?n.id:n.stepId+':'+n.role).sort().join('/');
    if(seen.has(key))return;seen.add(key);
    structures.push({code,title,materials:nodes.map(n=>n.material),nodeIds:nodes.map(n=>n.id),stepIds:[...new Set(nodes.map(n=>n.stepId.replace(/-oxide$/,'')))],evidence,missing,status:missing.length?'条件待核实':'几何候选'});
  }
  for(const [aid,bid]of graph.edges) {
    const a=nodeById.get(aid),b=nodeById.get(bid);
    if(sem(a)&&sem(b)) {
      const align=bandAlignment(mat(a),mat(b),selections,[[a.minThicknessNm,a.maxThicknessNm],[b.minThicknessNm,b.maxThicknessNm]]);
      const pair=interfaceKey(a.material,b.material);
      if(!interfaceKeys.has(pair)){interfaces.push({a:a.material,b:b.material,...align});interfaceKeys.add(pair);}
      else if(align.type==='unknown'){
        const index=interfaces.findIndex(i=>interfaceKey(i.a,i.b)===pair),previous=interfaces[index];
        interfaces[index]={a:previous.a,b:previous.b,type:'unknown',profileId:align.profileId,note:align.note};
      }
      const pn=[a.doping,b.doping].sort().join('')==='np';
      const samepol=a.doping===b.doping&&['n','p'].includes(a.doping);
      if(pn)add('PN',a.material===b.material?'PN 同质结候选':'PN 异质结候选',[a,b],['p 型与 n 型区域实际接触；载流子类型来自配方设定。'],['实际载流子浓度与温度','界面陷阱和接触后电势分布']);
      else if(samepol)add('ISOTYPE',`${a.doping}–${b.doping} 同型结候选`,[a,b],['两侧载流子类型相同。'],['掺杂浓度与实际带阶']);
      if(a.material!==b.material)add('HETERO',align.type==='unknown'?'异质界面 · 能带类型未知':`Type-${align.type} 异质界面（${align.reference==='relative-interface'?'文献档案':'真空近似'}）`,[a,b],[align.note],align.type==='unknown'?['适用的电子带隙、亲和能或界面档案']:align.reference==='relative-interface'?['当前样品的独立验证']:['界面实测带阶']);
    } else if((metal(a)&&sem(b))||(metal(b)&&sem(a))) {
      const c=metal(a)?a:b,s=sem(a)?a:b,m=mat(c),sm=mat(s);
      let note='功函数或半导体带边缺失，接触类型未确定。';
      if(known(m.workFunction)&&!bandDataIssue(sm)) {
        const electron=m.workFunction.value-sm.affinity.value,hole=sm.bandGap.value-electron;
        note=`理想电子势垒 ${electron.toFixed(2)} eV；空穴势垒 ${hole.toFixed(2)} eV。负值仅指理想带边关系。`;
      } else if(bandDataIssue(sm))note=bandDataIssue(sm)+'，未计算理想接触势垒。';
      add('MS','导体–半导体接触候选',[c,s],[note],['费米能级钉扎、界面残留和接触输运模型']);
    }
  }
  for(const center of graph.nodes) {
    const ns=[...neighbors.get(center.id)].map(id=>nodeById.get(id));
    for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++) {
      const a=ns[i],b=ns[j];
      if(sem(center)&&center.doping==='i'&&sem(a)&&sem(b)&&[a.doping,b.doping].sort().join('')==='np')
        add('PIN','PIN 结构候选',[a,center,b],['p / 低掺杂半导体 / n 连续接触。'],['i 区载流子浓度与耗尽条件','寿命、吸收系数和电极收集路径']);
      if(!ins(center))continue;
      if(!graph.sandwiches.includes([a.id,center.id,b.id].join(':'))&&!graph.sandwiches.includes([b.id,center.id,a.id].join(':')))continue;
      if(metal(a)&&metal(b)) {
        if(conductorNet.get(a.id)!==conductorNet.get(b.id))add('MIM','MIM 电容 / 势垒结构候选',[a,center,b],['两个独立导体区域在局部夹持介质，未发现导体短接。'],['隧穿势垒与漏电参数','电阻切换需额外缺陷/离子/铁电动态模型']);
        else add('SHORT','夹层电极导体短接候选',[a,center,b],['介质两侧电极另有连续导体路径相连；当前几何不构成独立 MIM 端子。'],['台阶侧壁绝缘覆盖与实际漏电']);
      }
      if(sem(a)&&sem(b))add('SIS','SIS 绝缘势垒结构候选',[a,center,b],['中间为绝缘介质，不能标为 PIN 的 i 区。'],['势垒厚度、界面带阶与隧穿机制']);
      if((metal(a)&&sem(b))||(metal(b)&&sem(a))) {
        const gate=metal(a)?a:b,channel=sem(a)?a:b;
        add('MIS','MIS / MOS 栅堆栈候选',[gate,center,channel],['导体 / 介质 / 半导体接触路径存在。'],['界面态、固定电荷和栅漏电']);
        if(gate.role==='gate') {
          const contactNets=new Set([...neighbors.get(channel.id)].filter(id=>conductorNet.has(id)).map(id=>conductorNet.get(id)));
          const contacts=graph.nodes.filter(n=>conductorNet.has(n.id)&&contactNets.has(conductorNet.get(n.id)));
          const source=contacts.find(n=>n.role==='source'),drain=contacts.find(n=>n.role==='drain');
          const directGate=contactNets.has(conductorNet.get(gate.id));
          const terminalsShorted=source&&drain&&conductorNet.get(source.id)===conductorNet.get(drain.id);
          if(terminalsShorted)add('SHORT','源漏导体短接候选',[source,drain],['源漏之间存在连续导体路径，不能按独立源漏 FET 处理。']);
          if(source&&drain&&!directGate&&!terminalsShorted) {
            const bottom=graph.sandwiches.includes([gate.id,center.id,channel.id].join(':'));
            add('FET',bottom?'底栅 FET 拓扑候选':'顶栅 FET 拓扑候选',[source,channel,drain,center,gate],['源漏通过独立导体网络接触同一连通沟道；栅极通过介质耦合。'],['迁移率、载流子浓度、接触电阻与阈值参数']);
          }
        }
      }
    }
  }
  const fets=structures.filter(s=>s.code==='FET');
  if(fets.some(s=>s.title.startsWith('底'))&&fets.some(s=>s.title.startsWith('顶'))) {
    // Matching channel identity is required; separate devices must not become a dual-gate FET.
    const channels=new Map();
    for(const f of fets){const key=f.nodeIds[1];channels.set(key,[...(channels.get(key)||[]),f]);}
    if([...channels.values()].some(fs=>fs.some(f=>f.title.startsWith('底'))&&fs.some(f=>f.title.startsWith('顶'))))
      structures.push({code:'DUAL_GATE',title:'双栅 FET 拓扑候选',materials:[],stepIds:[],evidence:['同一沟道检测到顶栅与底栅。'],missing:['双栅耦合模型'],status:'条件待核实'});
  }
  return {structures,interfaces,graph,notes:['结构识别与功能预测分开；候选结构不保证整流、记忆或 DVS 功能。','真空参考与文献相对带边分别显示；平衡求解采用独立 1D 硅模型。']};
}

export function diodeCurve({saturationA,ideality,temperatureK,minV,maxV,photocurrentA}) {
  if(![saturationA,ideality,temperatureK,minV,maxV,photocurrentA].every(Number.isFinite)||saturationA<=0||ideality<=0||temperatureK<=0||maxV<=minV||photocurrentA<0)throw Error('曲线模型参数无效。');
  const vt=8.617333262145e-5*temperatureK;
  return Array.from({length:101},(_,i)=>{
    const voltageV=minV+(maxV-minV)*i/100,currentA=saturationA*Math.expm1(voltageV/(ideality*vt))-photocurrentA;
    if(!Number.isFinite(voltageV)||!Number.isFinite(currentA))throw Error('曲线超出数值范围，请缩小扫描范围或调整理想因子、温度；未生成截断曲线。');
    return {voltageV,currentA};
  });
}
