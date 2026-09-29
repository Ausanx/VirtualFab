const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,-1000,1000));
export const jobIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const atomicSettings={functional:'PBE',ecutwfcRy:60,ecutrhoRy:480,kDensity:6,kSampling:12,convThrRy:1e-8,cutoffStepRy:20,kStep:6,vacuumStepAngstrom:5,energyToleranceMevAtom:5,gapToleranceEv:0.05,threads:2,maxSeconds:3600};
export function atomicTemplate(name='Si'){
  const a=5.43,b=3.18;
  const structure=name==='MoS2'?{
    name:'MoS2 monolayer 1H',dimensionality:2,symbols:['Mo','S','S'],
    cellAngstrom:[[b,0,0],[-b/2,b*Math.sqrt(3)/2,0],[0,0,23.19]],
    positionsAngstrom:[[0,0,11.595],[b/2,b/(2*Math.sqrt(3)),10],[b/2,b/(2*Math.sqrt(3)),13.19]],
    source:'ASE-style 1H prototype; a=3.18 A, S-S thickness=3.19 A; fixed illustrative geometry, not relaxed.',
  }:{
    name:'Si diamond primitive',dimensionality:3,symbols:['Si','Si'],
    cellAngstrom:[[0,a/2,a/2],[a/2,0,a/2],[a/2,a/2,0]],
    positionsAngstrom:[[0,0,0],[a/4,a/4,a/4]],
    source:'Diamond primitive prototype; a=5.43 A; fixed illustrative geometry, not relaxed.',
  };
  return {schemaVersion:1,structure,settings:{...atomicSettings},jobs:[]};
}
export function validateDft(d){
  const s=d?.structure,t=d?.settings;
  if(d?.schemaVersion!==1||!s||!t)throw Error('原子计算配置版本无效。');
  if(typeof s.name!=='string'||!s.name.trim()||s.name.length>120||![2,3].includes(s.dimensionality))throw Error('原子结构名称或周期维度无效。');
  if(typeof s.source!=='string'||s.source.length>2000)throw Error('原子结构来源无效。');
  if(!Array.isArray(s.symbols)||s.symbols.length<1||s.symbols.length>64||s.symbols.some(x=>!['Si','Mo','S'].includes(x)))throw Error('首版支持 1–64 个 Si/Mo/S 原子；其他元素需要独立赝势与标定。');
  if(!Array.isArray(s.positionsAngstrom)||s.positionsAngstrom.length!==s.symbols.length||!s.positionsAngstrom.every(vector)||!Array.isArray(s.cellAngstrom)||s.cellAngstrom.length!==3||!s.cellAngstrom.every(vector))throw Error('晶胞和原子位置需要有限的三维坐标，单位 Å。');
  const [a,b,c]=s.cellAngstrom,volume=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
  if(Math.abs(volume)<1||Math.abs(volume)>1e6)throw Error('晶胞体积无效或三条晶格矢量线性相关。');
  if(s.dimensionality===2){
    const z=s.positionsAngstrom.map(p=>p[2]),thickness=Math.max(...z)-Math.min(...z);
    if(Math.abs(a[2])+Math.abs(b[2])+Math.abs(c[0])+Math.abs(c[1])>1e-6||c[2]<2*thickness+10.6||Math.min(...z)<thickness/2+5.3||Math.max(...z)>c[2]-thickness/2-5.3)throw Error('二维模型需 XY 面内晶格、垂直 Z 晶格和居中薄层；需足够真空以使用 QE 二维截断。');
  }
  if(t.functional!=='PBE')throw Error('首版仅验证 PBE，不包含 SOC、磁性、杂化泛函或 GW。');
  for(const [key,min,max] of [['ecutwfcRy',20,160],['ecutrhoRy',160,1600],['convThrRy',1e-12,1e-5],['cutoffStepRy',5,40],['vacuumStepAngstrom',2,15],['energyToleranceMevAtom',0.01,100],['gapToleranceEv',0.001,1],['maxSeconds',10,14400]])if(!finite(t[key],min,max))throw Error(`DFT 参数 ${key} 超出支持范围。`);
  if(t.ecutrhoRy<t.ecutwfcRy*8||t.ecutwfcRy+t.cutoffStepRy>200)throw Error('USPP 电荷密度截断需至少为波函数截断的 8 倍，扫描最高截断不超过 200 Ry。');
  for(const [key,min,max] of [['kDensity',2,18],['kSampling',4,24],['kStep',2,8],['threads',1,4]])if(!Number.isInteger(t[key])||t[key]<min||t[key]>max)throw Error(`DFT 参数 ${key} 需为 ${min}–${max} 的整数。`);
  if(t.kSampling<t.kDensity||t.kSampling+t.kStep>30||t.kDensity+t.kStep>24)throw Error('能带采样不能稀于电荷密度网格；扫描最高网格需在支持范围内。');
  if(d.jobs!==undefined&&(!Array.isArray(d.jobs)||d.jobs.length>100||d.jobs.some(id=>typeof id!=='string'||!jobIdPattern.test(id))||new Set(d.jobs).size!==d.jobs.length))throw Error('DFT 任务引用无效。');
  return d;
}
export function dftSnapshot(d){
  validateDft(d);const s=d.structure;
  return {schemaVersion:1,structure:{name:s.name,dimensionality:s.dimensionality,symbols:[...s.symbols],cellAngstrom:s.cellAngstrom.map(v=>[...v]),positionsAngstrom:s.positionsAngstrom.map(v=>[...v]),source:s.source},settings:Object.fromEntries(Object.keys(atomicSettings).map(k=>[k,d.settings[k]]))};
}
