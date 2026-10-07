import { simulate,contactGraph,cellPosition } from './engine.js';
import { validateDevicePhysics,validateEquilibrium } from './equilibrium.js';
import { createProject,step } from './recipes.js';

const axes=['x','y','z'],EPS=1e-8;
const near=(a,b)=>Math.abs(a-b)<EPS;
const contains=(a,b)=>axes.every(k=>b[k+'0']>=a[k+'0']-EPS&&b[k+'1']<=a[k+'1']+EPS);
const overlap=(a,b)=>axes.every(k=>Math.min(a[k+'1'],b[k+'1'])-Math.max(a[k+'0'],b[k+'0'])>EPS);
export function geometrySnapshot(project,through){
  // ponytail: exact process inputs invalidate conservatively; no persistent component-number heuristic.
  return JSON.stringify({sizeUm:project.sizeUm,resolution:project.resolution,steps:project.steps.slice(0,through+1),materials:project.materials});
}
function sampleBox(state,[ci,li]){
  const {x,y}=cellPosition(ci,state),d=state.sizeUm/state.resolution/2,l=state.cells[ci][li];
  return {x0:x-d,x1:x+d,y0:y-d,y1:y+d,z0:l.z0/1000||0,z1:l.z1/1000||0};
}
export function physicsGeometry(project,through=project.steps.length-1){
  const state=simulate(project,through),graph=contactGraph(state);
  for(const node of graph.nodes){
    node.box=Object.fromEntries(axes.flatMap(k=>[[k+'0',Infinity],[k+'1',-Infinity]]));
    for(const sample of node.samples){const b=sampleBox(state,sample);for(const k of axes){node.box[k+'0']=Math.min(node.box[k+'0'],b[k+'0']);node.box[k+'1']=Math.max(node.box[k+'1'],b[k+'1']);}}
    const b=sampleBox(state,node.samples[0]);
    node.binding={stepId:node.stepId,material:node.material,anchor:axes.map(k=>(b[k+'0']+b[k+'1'])/2),box:node.box,samples:node.samples.length};
  }
  return {state,graph,geometry:geometrySnapshot(project,through)};
}
const bindingKey=b=>JSON.stringify(b);
export function resolveBinding(graph,binding){return graph.nodes.find(n=>bindingKey(n.binding)===bindingKey(binding));}
export function emptyDevicePhysics(project,through,geometry=physicsGeometry(project,through)){
  return {schemaVersion:1,through,geometry:geometry.geometry,regions:[],path:{axis:'x',x:0,y:0,z:-1,startUm:-2,endUm:2,meshNm:10,start:{kind:'truncation'},end:{kind:'truncation'}},jobs:[]};
}
export function physicalRegion(node,box=node.box){
  const missing=()=>({value:null,unit:'cm^-3',evidence:'missing',source:'',note:''});
  return {id:crypto.randomUUID(),name:'硅物理区域',binding:structuredClone(node.binding),box:{...box},donor:missing(),acceptor:missing(),basis:'ionized',activation:null,ionization:'unknown',assumption:''};
}
export function deviceInputKey(project,through){return JSON.stringify({geometry:geometrySnapshot(project,through),physics:{...project.devicePhysics,jobs:[]},through});}
export function siliconBenchmark(pin=false){
  const project=createProject('blank');project.name=pin?'硅 PIN 平衡基准':'硅 PN 平衡基准';project.sizeUm=8;project.resolution=16;
  project.steps=[step('substrate',{oxideNm:0,waferThicknessUm:4,doping:'unknown'},'体硅：掺杂另行给定')];
  const g=physicsGeometry(project,0),p=emptyDevicePhysics(project,0,g),node=g.graph.nodes.find(n=>n.material==='Si');
  p.path={...p.path,z:-2,startUm:pin?-2.5:-2,endUm:pin?2.5:2};
  const intervals=pin?[['p',-2.5,-.5],['i',-.5,.5],['n',.5,2.5]]:[['p',-2,0],['n',0,2]];
  p.regions=intervals.map(([type,a,b])=>{
    const r=physicalRegion(node,{...node.box,x0:a,x1:b});r.name=type+'-Si';r.ionization='full';r.assumption='理想基准：给定分段掺杂，完全电离、无补偿；不是工艺预测。';
    for(const key of ['donor','acceptor'])r[key]={value:(type==='p'&&key==='acceptor'||type==='n'&&key==='donor')?1e16:0,unit:'cm^-3',evidence:'estimated',source:'公开 PN/PIN 理想模型基准；浓度为示例输入，非样品实测',note:'300 K 体硅，给定电离杂质浓度；明确零表示该类杂质缺席'};
    return r;
  });project.devicePhysics=p;return project;
}
export function mapDevice(project,through=project.devicePhysics?.through){
  const p=validateDevicePhysics(project.devicePhysics),g=physicsGeometry(project,through),{state,graph}=g;
  if(project.materials.find(m=>m.id==='Si')?.category!=='semiconductor')throw Error('硅材料类别与体硅模型不符。');
  if(through!==p.through||g.geometry!==p.geometry)throw Error('工艺、材料或采样网格已改变；空间绑定失效，请重新选择区域。');
  if(state.stoppedAt!==null||state.completed!==through)throw Error('当前工艺未成功完成，不能生成物理模型。');
  if(state.diagnostics.some(d=>['SUBGRID','EMPTY_MASK','EMPTY_TRANSFER'].includes(d.code)))throw Error('工艺含未解析的小尺寸特征或空图案，不能生成可靠一维映射。');
  const path=p.path,axis=path.axis,cross=axes.filter(k=>k!==axis),low=Math.min(path.startUm,path.endUm),high=Math.max(path.startUm,path.endUm),direction=Math.sign(path.endUm-path.startUm);
  const midpoint={...path,[axis]:(low+high)/2};
  const hits=graph.nodes.filter(n=>n.material==='Si'&&axes.every(k=>midpoint[k]>n.box[k+'0']-EPS&&midpoint[k]<n.box[k+'1']+EPS)&&n.samples.some(s=>{const b=sampleBox(state,s);return axes.every(k=>midpoint[k]>=b[k+'0']-EPS&&midpoint[k]<b[k+'1']-EPS);}));
  if(hits.length!==1)throw Error('路径中心未唯一落在硅区域内；请选择硅内部坐标。');
  const connected=new Set([hits[0].id]);let changed=true;
  while(changed){changed=false;for(const [a,b]of graph.edges){if(connected.has(a)===connected.has(b))continue;const other=connected.has(a)?b:a;if(graph.nodes.find(n=>n.id===other).material==='Si'){connected.add(other);changed=true;}}}
  const nodes=graph.nodes.filter(n=>connected.has(n.id)),box=Object.fromEntries(axes.flatMap(k=>[[k+'0',Math.min(...nodes.map(n=>n.box[k+'0']))],[k+'1',Math.max(...nodes.map(n=>n.box[k+'1']))]]));
  if(low<box[axis+'0']-EPS||high>box[axis+'1']+EPS)throw Error('路径越出连续硅域，存在间断、介质或真空。');
  // ponytail: accept only a complete rectangular Si component; reject branches instead of estimating 3D current paths.
  const perCell=new Map();
  for(const n of nodes)for(const [ci,li]of n.samples){const l=state.cells[ci][li];if(!perCell.has(ci))perCell.set(ci,[]);perCell.get(ci).push([l.z0/1000,l.z1/1000]);}
  const dx=state.sizeUm/state.resolution,expected=Math.round((box.x1-box.x0)/dx)*Math.round((box.y1-box.y0)/dx);
  if(perCell.size!==expected)throw Error('硅域含分支、孔洞或截面变化，不适用当前一维模型。');
  for(const intervals of perCell.values()){
    intervals.sort((a,b)=>a[0]-b[0]);let z=box.z0;
    for(const [a,b]of intervals){if(!near(a,z))throw Error('硅域存在间断或横向厚度变化，不适用一维模型。');z=b;}
    if(!near(z,box.z1))throw Error('硅域存在横向厚度变化，不适用一维模型。');
  }
  const domain={...box,[axis+'0']:low,[axis+'1']:high},regions=[];
  for(const r of p.regions){
    const n=resolveBinding(graph,r.binding);if(!n)throw Error(`${r.name} 的空间绑定失效。`);
    if(!contains(n.box,r.box))throw Error(`${r.name} 超出了绑定区域。`);
    if(!connected.has(n.id)||!overlap(r.box,domain))continue;
    if(!cross.every(k=>near(r.box[k+'0'],box[k+'0'])&&near(r.box[k+'1'],box[k+'1'])))throw Error('物理掺杂未覆盖完整横截面或横向不均匀，不能只取中心线求解。');
    const a=Math.max(low,r.box[axis+'0']),b=Math.min(high,r.box[axis+'1']);
    // A bounding box alone is not proof that the selected component fills the assigned volume.
    const assigned={...r.box,[axis+'0']:a,[axis+'1']:b};
    let volume=0;for(const s of n.samples){const sb=sampleBox(state,s);if(overlap(sb,assigned))volume+=axes.reduce((v,k)=>v*(Math.min(sb[k+'1'],assigned[k+'1'])-Math.max(sb[k+'0'],assigned[k+'0'])),1);}
    const expectedVolume=axes.reduce((v,k)=>v*(assigned[k+'1']-assigned[k+'0']),1);
    if(Math.abs(volume-expectedVolume)>1e-7*Math.max(1,expectedVolume))throw Error('指定空间范围含其他区域或空洞，请缩小物理区域。');
    if(r.donor.value===null||r.acceptor.value===null)throw Error(`${r.name} 缺少施主或受主浓度；未知不等于零。`);
    if(r.basis==='carrier'||r.ionization!=='full'||!r.assumption.trim()||(r.basis==='nominal'&&r.activation!==1)||(r.basis!=='nominal'&&r.activation!==null&&r.activation!==1))throw Error(`${r.name} 不符合已验证的完全激活/完全电离模型；自由载流子浓度、部分激活或未知电离不能用于求解。`);
    const nd=r.donor.value,na=r.acceptor.value;
    if(nd>0&&na>0)throw Error('补偿掺杂尚未验证，不能静默忽略。');
    const type=na>0?'p':nd>0?'n':'i';
    regions.push({id:r.id,name:r.name,type,startUm:direction>0?a:b,endUm:direction>0?b:a,lengthUm:b-a,donor:r.donor,acceptor:r.acceptor,binding:r.binding,box:r.box,basis:r.basis,activation:r.activation,ionization:r.ionization,assumption:r.assumption});
  }
  regions.sort((a,b)=>direction*(a.startUm-b.startUm));let cursor=path.startUm;
  for(const r of regions){if(!near(r.startUm,cursor))throw Error('物理区域沿路径存在缺失、重叠或重复赋值。');cursor=r.endUm;}
  if(!near(cursor,path.endUm))throw Error('路径尚未被物理区域完整覆盖；请补齐掺杂。');
  const sequence=regions.map(r=>r.type).join('');if(!['pn','pin'].includes(sequence))throw Error('当前只支持沿路径顺序 p–n 或 p–i–n；i 必须是明确指定的本征硅。');
  const boundaries={};
  for(const key of ['start','end']){
    const b=path[key];if(b.kind==='truncation'){boundaries[key]={kind:'truncation',coordinateUm:path[key+'Um'],assumption:'人为截断；理想中性欧姆边界，不是真实工艺电极'};continue;}
    const n=resolveBinding(graph,b.binding),material=project.materials.find(m=>m.id===n?.material);
    if(!n||!['conductor','tco'].includes(material?.category))throw Error('所选端子不是有效金属/透明电极。');
    const coordinate=path[key+'Um'];
    const lower=near(coordinate,box[axis+'0']),face=lower?'1':'0';
    let area=0;for(const sample of n.samples){const sb=sampleBox(state,sample);if(near(sb[axis+face],coordinate)&&cross.every(k=>Math.min(sb[k+'1'],box[k+'1'])-Math.max(sb[k+'0'],box[k+'0'])>EPS))area+=cross.reduce((v,k)=>v*(Math.min(sb[k+'1'],box[k+'1'])-Math.max(sb[k+'0'],box[k+'0'])),1);}
    const expectedArea=cross.reduce((v,k)=>v*(box[k+'1']-box[k+'0']),1);
    if(![box[axis+'0'],box[axis+'1']].some(v=>near(v,coordinate))||!near(n.box[axis+face],coordinate)||Math.abs(area-expectedArea)>1e-7*Math.max(1,expectedArea)||!graph.edges.some(([a,b])=>a===n.id&&connected.has(b)||b===n.id&&connected.has(a)))throw Error('电极必须直接覆盖完整硅端面；局部接触或介质隔离不适用理想一维端部。');
    boundaries[key]={kind:'electrode',binding:n.binding,coordinateUm:coordinate,assumption:'真实几何接触；人为假设理想欧姆，未标定接触势垒'};
  }
  if(boundaries.start.kind==='electrode'&&boundaries.end.kind==='electrode'&&bindingKey(boundaries.start.binding)===bindingKey(boundaries.end.binding))throw Error('两端选择了同一连通电极，端子短接。');
  const allowed=new Set(Object.values(boundaries).filter(b=>b.binding).map(b=>resolveBinding(graph,b.binding).id));
  if(allowed.size===2){
    const conductive=new Set(graph.nodes.filter(n=>['conductor','tco','semimetal'].includes(project.materials.find(m=>m.id===n.material)?.category)).map(n=>n.id)),ids=[...allowed],reachable=new Set([ids[0]]);let expanded=true;
    while(expanded){expanded=false;for(const [a,b]of graph.edges)if(conductive.has(a)&&conductive.has(b)&&reachable.has(a)!==reachable.has(b)){reachable.add(reachable.has(a)?b:a);expanded=true;}}
    if(reachable.has(ids[1]))throw Error('两端电极通过其他导电材料连通，端子短接。');
  }
  for(const [a,b]of graph.edges){if(connected.has(a)===connected.has(b))continue;const n=graph.nodes.find(n=>n.id===(connected.has(a)?b:a)),m=project.materials.find(m=>m.id===n.material);
    if(m?.category==='semiconductor'||['conductor','tco','semimetal'].includes(m?.category)&&!allowed.has(n.id))throw Error('硅域连接其他半导体或未选择的导电支路/端子，不能忽略旁路。');
  }
  const insulated=new Set(connected);let expanded=true;
  while(expanded){expanded=false;for(const [a,b]of graph.edges)if(insulated.has(a)!==insulated.has(b)){
    const other=insulated.has(a)?b:a,n=graph.nodes.find(n=>n.id===other);
    if(project.materials.find(m=>m.id===n.material)?.category==='dielectric'){insulated.add(other);expanded=true;}
  }}
  for(const [a,b]of graph.edges)if(insulated.has(a)!==insulated.has(b)){
    const n=graph.nodes.find(n=>n.id===(insulated.has(a)?b:a)),m=project.materials.find(m=>m.id===n.material);
    if(['conductor','tco','semimetal','semiconductor'].includes(m?.category)&&!allowed.has(n.id))throw Error('硅域存在未建模的介质隔离电极或半导体；不能忽略栅控/侧面耦合。');
  }
  if(graph.nodes.some(n=>n.role==='gate'))throw Error('当前结构含栅极；一维 PN/PIN 模型不包含栅控边界。');
  const first=regions[0],last=regions.at(-1),config=validateEquilibrium({material:'Si',temperatureK:300,acceptorCm3:first.acceptor.value,donorCm3:last.donor.value,pLengthUm:first.lengthUm,nLengthUm:last.lengthUm,intrinsicLengthUm:sequence==='pin'?regions[1].lengthUm:0,meshNm:path.meshNm});
  return {schemaVersion:1,config,axis,direction,path:structuredClone(path),domain,regions,boundaries,crossSectionUm2:cross.reduce((v,k)=>v*(box[k+'1']-box[k+'0']),1),geometry:g.geometry,through,checks:['工艺快照一致','连续矩形硅域，无分支或孔洞','完整横截面掺杂一致','无未选择的导电支路或异质接触','给定掺杂：完全电离、无补偿、300 K','端部几何与人为边界分开']};
}
