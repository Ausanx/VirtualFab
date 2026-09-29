import { getMaterial } from './materials.js';
import { processTypes, patterns } from './recipes.js';

const EPS=1e-8;
const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
export function validateProject(p) {
  if(!p||p.version!==1||typeof p.name!=='string'||p.name.length>120) throw Error('不是有效的 VirtualFab v1 项目。');
  if(!finite(p.sizeUm,2,1000)||!Number.isInteger(p.resolution)||p.resolution<8||p.resolution>80) throw Error('局部区域需为 2–1000 μm，采样列数需为 8–80。');
  if(!Array.isArray(p.materials)||p.materials.length<1||p.materials.length>200) throw Error('材料数量需为 1–200。');
  const ids=new Set();
  for(const m of p.materials) {
    if(!m||typeof m.id!=='string'||m.id.length>80||!m.id||ids.has(m.id)) throw Error('材料 ID 为空、重复或过长。');
    ids.add(m.id);
    if(typeof m.name!=='string'||m.name.length>120||!/^#[0-9a-f]{6}$/i.test(m.color)||!['semiconductor','conductor','tco','semimetal','dielectric','substrate','resist'].includes(m.category)) throw Error('材料名称、颜色或类别无效。');
    if(!['n','p','i','unknown'].includes(m.polarity)) throw Error('材料载流子类型无效。');
    if(m.category==='resist'&&!['positive','negative'].includes(m.tone)) throw Error('光刻胶需指定正胶或负胶。');
    for(const key of ['bandGap','affinity','workFunction']) {
      const v=m[key];
      if(!v||!['measured','derived','estimated','missing'].includes(v.evidence)||!(v.value===null||finite(v.value,0,30))) throw Error(`${m.id} 的 ${key} 参数无效。`);
      if((v.evidence==='missing')!==(v.value===null)) throw Error('缺失值必须为 null，不能用零占位。');
      if(v.evidence==='measured'&&(typeof v.source!=='string'||!v.source.trim()||typeof v.note!=='string'||!v.note.trim())) throw Error('实测参数必须填写来源和测量条件。');
      if(v.source!==undefined&&(typeof v.source!=='string'||v.source.length>2000)) throw Error('参数来源无效。');
      if(v.note!==undefined&&(typeof v.note!=='string'||v.note.length>2000)) throw Error('参数适用条件无效。');
    }
  }
  if(!Array.isArray(p.steps)||p.steps.length<1||p.steps.length>150) throw Error('工艺步骤需为 1–150。');
  const stepIds=new Set();
  for(const s of p.steps) {
    if(!s||typeof s.id!=='string'||s.id.length>100||stepIds.has(s.id)||!processTypes[s.type]||typeof s.name!=='string'||s.name.length>120||typeof s.enabled!=='boolean'||!s.params||typeof s.params!=='object') throw Error('工艺卡片格式或 ID 无效。');
    stepIds.add(s.id);
    for(const [key,value] of Object.entries(processTypes[s.type].defaults)) {
      const x=s.params[key];
      if(typeof x!==typeof value) throw Error(`${s.name} 的 ${key} 类型无效。`);
      if(typeof x==='number'&&!Number.isFinite(x)) throw Error(`${s.name} 存在无效数值。`);
      if(typeof x==='string'&&x.length>2000) throw Error('工艺参数文本过长。');
    }
    if(s.params.material&&!ids.has(s.params.material)) throw Error(`找不到材料 ${s.params.material}。`);
    const ranges={thicknessNm:[0.05,100000],oxideNm:[0,10000],waferInch:[1,12],waferThicknessUm:[1,2000],widthMm:[0.1,300],lengthMm:[0.1,300],widthUm:[0.01,2000],lengthUm:[0.01,2000],gapUm:[0,2000],pitchUm:[0.01,2000],count:[1,30],durationS:[0,1000000],temperatureC:[-273,2000],rateNmS:[0,100000],rpm:[0,20000],offsetXUm:[-2000,2000],offsetYUm:[-2000,2000]};
    for(const [key,[min,max]] of Object.entries(ranges)) if(s.params[key]!==undefined&&!finite(s.params[key],min,max)) throw Error(`${s.name}: ${key} 应在 ${min}–${max} 内。`);
    if(s.type==='expose'&&(!patterns[s.params.pattern]||!Number.isInteger(s.params.count))) throw Error('掩膜图案或线条数量无效。');
    if(s.params.doping&&!['n','p','i','unknown'].includes(s.params.doping)) throw Error('区域载流子类型无效。');
    if(s.params.role&&!['electrode','contacts','source','drain','gate','channel','active','none'].includes(s.params.role)) throw Error('区域端子角色无效。');
    if(s.type==='etch'&&!['measured','derived','estimated'].includes(s.params.rateEvidence)) throw Error('刻蚀速率证据类型无效。');
    if(s.type==='etch'&&s.params.rateEvidence==='measured'&&!s.params.rateSource) throw Error('实测刻蚀速率需要来源与条件。');
  }
  return p;
}

export function inPattern(x,y,p) {
  x-=p.offsetXUm||0; y-=p.offsetYUm||0;
  const w=p.widthUm/2,l=p.lengthUm/2;
  let hit=false;
  switch(p.pattern) {
    case 'all':hit=true;break;
    case 'rect':hit=Math.abs(x)<w&&Math.abs(y)<l;break;
    case 'stripe-x':hit=Math.abs(y)<w&&Math.abs(x)<l;break;
    case 'stripe-y':hit=Math.abs(x)<w&&Math.abs(y)<l;break;
    case 'array-x':case 'array-y': {
      const cross=p.pattern==='array-x'?y:x,along=p.pattern==='array-x'?x:y;
      for(let k=0;k<p.count;k++) if(Math.abs(cross-(k-(p.count-1)/2)*p.pitchUm)<w&&Math.abs(along)<l) hit=true;
      break;
    }
    case 'contacts':hit=Math.abs(x)>p.gapUm/2&&Math.abs(x)<l&&Math.abs(y)<w;break;
  }
  return p.invert?!hit:hit;
}
export function cellPosition(index,state) {
  const dx=state.sizeUm/state.resolution;
  return {x:(index%state.resolution+.5)*dx-state.sizeUm/2,y:(Math.floor(index/state.resolution)+.5)*dx-state.sizeUm/2};
}
export function simulate(project,through=project.steps.length-1) {
  validateProject(project);
  const state={sizeUm:project.sizeUm,resolution:project.resolution,cells:Array.from({length:project.resolution**2},()=>[]),diagnostics:[],substrate:null,activeResist:null,exposure:null,lastPattern:null,completed:-1,stoppedAt:null};
  function warn(code,message,s,index,severity='warning') { state.diagnostics.push({code,message,stepId:s.id,index,severity}); }
  for(let index=0;index<=Math.min(through,project.steps.length-1);index++) {
    const s=project.steps[index],p=s.params,m=getMaterial(project.materials,p.material);
    if(!s.enabled) {state.completed=index;continue;}
    try {
      if(s.type!=='substrate'&&!state.substrate) throw Error('请先准备衬底。');
      if(s.type==='substrate') {
        if(state.substrate) throw Error('衬底已存在；请编辑第一张卡片或创建新项目。');
        if(!['Si','glass','sapphire'].includes(m.id)) throw Error('首版衬底支持 Si、玻璃和蓝宝石。');
        const oxide=m.id==='Si'?p.oxideNm:0;
        if(oxide>0&&!getMaterial(project.materials,'SiO2')) throw Error('缺少 SiO₂ 材料记录。');
        state.substrate={...p,oxideNm:oxide};
        state.cells.forEach(c=>{
          c.push({material:m.id,z0:-p.waferThicknessUm*1000-oxide,z1:-oxide,stepId:s.id,role:p.backgate&&m.id==='Si'?'gate':'support',doping:p.doping});
          if(oxide>0)c.push({material:'SiO2',z0:-oxide,z1:0,stepId:s.id+'-oxide',role:'none',doping:'unknown'});
        });
      } else if(s.type==='dice') {
        const diameter=state.substrate.waferInch*25.4;
        if(Math.hypot(p.widthMm,p.lengthMm)>diameter) throw Error('该尺寸的矩形芯片无法装入所选圆形晶圆。');
        if(Math.min(p.widthMm,p.lengthMm)*1000<state.sizeUm) throw Error('划片尺寸小于当前局部模拟区域。');
        state.substrate.die={widthMm:p.widthMm,lengthMm:p.lengthMm};
      } else if(s.type==='coat') {
        if(m.category!=='resist')throw Error('涂胶步骤必须选择光刻胶材料。');
        if(state.activeResist)throw Error('已有胶层；首版需先去胶，再进行下一轮光刻。');
        state.activeResist={id:s.id,material:m.id,baked:false,exposed:false,postBaked:false,developed:false,nonDirectionalDeposit:false};
        state.lastPattern=null;
        state.cells.forEach(c=>{const top=c.at(-1)?.z1||0;c.push({material:m.id,z0:top,z1:top+p.thicknessNm,stepId:s.id,role:'resist',doping:'unknown'});});
        warn('RESIST_CALIBRATION','胶厚直接采用卡片输入；旋涂转速尚未通过该牌号曲线换算。',s,index,'info');
      } else if(s.type==='bake') {
        if(!state.activeResist)throw Error('烘烤卡片需要当前胶层。');
        if(p.durationS<=0)throw Error('烘烤时间必须大于 0 s；不执行时请禁用该步骤。');
        const postExposure=state.activeResist.exposed&&!state.activeResist.developed;
        if(state.activeResist.material==='NR9-3000PY'&&!state.activeResist.developed) {
          const substrate=state.substrate.material,referenceTime=substrate==='glass'?210:60,referenceTemperature=postExposure?100:150;
          if(substrate==='sapphire'||p.temperatureC!==referenceTemperature||p.durationS!==referenceTime)
            warn(postExposure?'NR9_PEB_UNVERIFIED':'NR9_SOFTBAKE_UNVERIFIED',`NR9-3000PY ${postExposure?'曝光后烘烤':'软烘'}尚未按当前衬底校准；厂商参考为 ${referenceTemperature} °C / 60 s（玻璃约需 3.5 倍时间）。后续几何仅为假设。`,s,index);
        }
        if(postExposure)state.activeResist.postBaked=true;
        else state.activeResist.baked=true;
      } else if(s.type==='expose') {
        if(!state.activeResist)throw Error('曝光前需要涂胶。');
        if(!state.activeResist.baked)warn('UNBAKED','未记录软烘；曝光按理想掩膜处理。',s,index);
        if(state.activeResist.developed)throw Error('此胶层已显影，请重新涂胶。');
        const pr=getMaterial(project.materials,state.activeResist.material);
        if(pr.id==='AZ5214E'&&pr.tone==='negative')throw Error('AZ 5214E 的反转模式需要反转烘烤和泛曝光；当前模型仅支持正胶模式。');
        const openings=new Uint8Array(state.cells.length);
        let openingCount=0;
        state.cells.forEach((c,i)=>{
          const pos=cellPosition(i,state),opening=inPattern(pos.x,pos.y,p),layer=c.find(l=>l.stepId===state.activeResist.id);
          openings[i]=Number(opening);
          if(layer) {layer.exposed=Boolean(layer.exposed||(pr.tone==='positive'?opening:!opening));if(opening)openingCount++;}
        });
        if(openingCount===0)warn('EMPTY_MASK','开口未覆盖采样中心；请检查偏移、尺寸或提高采样分辨率。',s,index);
        if(Math.min(p.widthUm,p.lengthUm)<2*state.sizeUm/state.resolution)warn('SUBGRID','特征宽度小于两列采样间距，几何结果不可靠。',s,index);
        state.activeResist.exposed=true;state.activeResist.postBaked=false;state.exposure={...p};state.lastPattern={stepId:s.id,openings};
      } else if(s.type==='develop') {
        if(!state.activeResist?.exposed)throw Error('显影前需要完成曝光。');
        const pr=getMaterial(project.materials,state.activeResist.material);
        if(pr.id==='NR9-3000PY'&&!state.activeResist.postBaked)throw Error('NR9-3000PY 显影前需要曝光后烘烤；请在曝光与显影之间加入烘烤步骤。');
        state.cells=state.cells.map(c=>c.filter(l=>!(l.stepId===state.activeResist.id&&(pr.tone==='positive'?l.exposed:!l.exposed))));
        state.activeResist.developed=true;state.exposure=null;
      } else if(s.type==='deposit'||s.type==='transfer') {
        if(['resist','substrate'].includes(m.category))throw Error('请通过涂胶或衬底卡片加入该材料。');
        const dielectric=m.category==='dielectric';
        const role=dielectric?'none':p.role;
        state.cells.forEach((c,i)=>{
          const pos=cellPosition(i,state);
          if(s.type==='transfer'&&!inPattern(pos.x,pos.y,{...p,pattern:'rect'}))return;
          const top=c.at(-1)?.z1||0;
          c.push({material:m.id,z0:top,z1:top+p.thicknessNm,stepId:s.id,role:role==='contacts'?(pos.x<0?'source':'drain'):role,doping:m.category==='semiconductor'?p.doping:'unknown'});
        });
        if(s.type==='deposit'&&['ALD','CVD','溅射'].includes(p.method))warn('TOP_SURFACE_APPROX','采用顶表面膜厚近似；侧壁覆盖、ALD 成核与溅射损伤尚未求解。',s,index,'info');
        if(state.activeResist&&s.type==='deposit') {
          if(!['热蒸镀','电子束蒸镀'].includes(p.method))state.activeResist.nonDirectionalDeposit=true;
          const thickness=state.cells.flat().find(l=>l.stepId===state.activeResist.id);
          if(thickness&&p.thicknessNm>(thickness.z1-thickness.z0)/3)warn('LIFTOFF_RATIO','沉积厚度超过胶厚的 1/3；需检查侧壁桥连与剥离窗口。',s,index);
        }
      } else if(s.type==='etch') {
        if(p.rateEvidence==='estimated')warn('ETCH_ESTIMATE','当前刻蚀速率为演示估算，请用匹配化学品、浓度、温度和膜质的数据替换。',s,index);
        let reached=0,blocked=0,cleared=0;
        for(const c of state.cells) {
          let time=p.durationS;
          while(time>EPS&&c.length) {
            const top=c.at(-1);
            if(top.role==='resist')break;
            if(top.material!==p.material) {blocked++;break;}
            reached++; if(p.rateNmS===0)break;
            const depth=p.rateNmS*time,thickness=top.z1-top.z0;
            if(depth>=thickness-EPS) {c.pop();time-=thickness/p.rateNmS;cleared++;}
            else {top.z1-=depth;break;}
          }
        }
        if(!reached)warn('NO_TARGET','刻蚀未触及指定材料：目标可能被胶或其他材料遮挡。',s,index);
        if(blocked||cleared)warn('UNKNOWN_SELECTIVITY','仅指定材料速率已知；其他外露材料保留，其化学兼容性与选择比尚未验证。',s,index);
        if(p.method!=='RIE')warn('LATERAL_NOT_SOLVED','此版本按垂直速率消耗厚度；湿法横向掏空未求解。',s,index);
      } else if(s.type==='liftoff'||s.type==='strip') {
        if(!state.activeResist)throw Error('当前没有可去除的胶层。');
        if(s.type==='liftoff'&&!state.activeResist.developed)throw Error('lift-off 需要已显影的胶层与开口。');
        const pr=getMaterial(project.materials,state.activeResist.material);
        if(s.type==='liftoff'&&pr.id==='SU8')throw Error('交联 SU-8 不支持此默认溶剂剥离模型，请更换配方。');
        if(s.type==='liftoff'&&state.activeResist.nonDirectionalDeposit)warn('LIFTOFF_CONFORMAL','胶上使用了非定向沉积；侧壁可能连续包覆，几何剥离结果仅为理想上限，需核对胶型与剥离可达性。',s,index);
        state.cells=state.cells.map(c=>{
          const at=c.findIndex(l=>l.stepId===state.activeResist.id);
          if(at<0)return c;
          if(s.type==='strip'&&at<c.length-1)throw Error('胶上仍有覆盖层，请使用 lift-off 并检查剥离可达性。');
          return c.slice(0,at);
        });
        state.activeResist=null;state.exposure=null;state.lastPattern=null;
      } else if(s.type==='anneal') {
        if(state.activeResist)warn('RESIST_HEAT','当前仍有胶层；需要核对该牌号热预算。',s,index);
        warn('ANNEAL_NOT_CALIBRATED','已记录退火历史；没有标定关系时，不自动更改缺陷、掺杂或接触电阻。',s,index,'info');
      } else if(s.type==='clean') {
        warn('CLEAN_RECORDED','已记录清洁条件；残留去除率与下层材料兼容性尚待核实。',s,index,'info');
      }
      state.completed=index;
    } catch(error) {warn('PROCESS_INVALID',error.message,s,index,'error');state.stoppedAt=index;break;}
  }
  return state;
}

// ponytail: connected components on sampled columns; exact sidewall surfaces require a 3D mesh solver.
export function contactGraph(state) {
  const all=[],cellIds=state.cells.map(c=>c.map(l=>{all.push(l);return all.length-1;}));
  const parent=all.map((_,i)=>i),find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
  const union=(a,b)=>{parent[find(a)]=find(b);},rawEdges=[];
  const same=(a,b)=>a.stepId===b.stepId&&a.role===b.role&&a.material===b.material&&a.doping===b.doping;
  const connect=(a,b)=>{if(same(all[a],all[b]))union(a,b);else rawEdges.push([a,b]);};
  const n=state.resolution;
  for(let ci=0;ci<cellIds.length;ci++) {
    const list=cellIds[ci];
    for(let k=1;k<list.length;k++)if(Math.abs(all[list[k-1]].z1-all[list[k]].z0)<EPS)connect(list[k-1],list[k]);
    for(const ni of [ci%n<n-1?ci+1:-1,ci+n<cellIds.length?ci+n:-1])if(ni>=0) {
      for(const a of list)for(const b of cellIds[ni])if(Math.min(all[a].z1,all[b].z1)-Math.max(all[a].z0,all[b].z0)>EPS)connect(a,b);
    }
  }
  const nodes=new Map(),edges=new Map();
  all.forEach((layer,i)=>{const id=find(i);if(!nodes.has(id))nodes.set(id,{...layer,id,segments:0});nodes.get(id).segments++;});
  for(const [a,b]of rawEdges) {const x=find(a),y=find(b);if(x!==y)edges.set([x,y].sort((u,v)=>u-v).join(':'),[x,y]);}
  const sandwiches=new Set();
  for(const ids of cellIds)for(let i=1;i<ids.length-1;i++) {
    const [a,b,c]=ids.slice(i-1,i+2);
    if(Math.abs(all[a].z1-all[b].z0)<EPS&&Math.abs(all[b].z1-all[c].z0)<EPS)
      sandwiches.add([find(a),find(b),find(c)].join(':'));
  }
  return {nodes:[...nodes.values()],edges:[...edges.values()],sandwiches:[...sandwiches]};
}
