// Numerical seeds are explicitly illustrative estimates, never silently measured values.
const estimate = (value, unit, note='示例估算；须按膜厚、晶相和制备条件校准') => ({ value, unit, evidence:'estimated', note, source:'' });
const missing = unit => ({ value:null, unit, evidence:'missing', note:'尚无经核实、适用于本工艺的数值', source:'' });
const semiconductor = (id, name, color, polarity, gap, affinity, reference, note='') => ({
  id,name,category:'semiconductor',color,polarity,
  bandGap:{...(gap===null?missing('eV'):estimate(gap,'eV')),kind:['MoS2','WS2','WSe2'].includes(id)?'optical':['Si','Te'].includes(id)?'transport':'unspecified'},
  affinity:{...(affinity===null?missing('eV'):estimate(affinity,'eV')),reference:'vacuum'},
  workFunction:missing('eV'), reference, note,
});
const conductor = (id,name,color,wf,reference='') => ({id,name,category:'conductor',color,polarity:'unknown',bandGap:missing('eV'),affinity:missing('eV'),workFunction:estimate(wf,'eV','表面状态相关的示例功函数；非实测接触势垒'),reference,note:''});
const dielectric = (id,name,color,gap,eps) => ({id,name,category:'dielectric',color,polarity:'unknown',bandGap:estimate(gap,'eV'),affinity:missing('eV'),workFunction:missing('eV'),permittivity:estimate(eps,'1'),reference:'',note:'介质 ≠ PIN 中的本征半导体；不自动具有电阻切换功能。'});
const resist = (id,tone,method,developer,remover,note) => ({id,name:id,category:'resist',color:'#BB8A80',polarity:'unknown',tone,method,developer,remover,bandGap:missing('eV'),affinity:missing('eV'),workFunction:missing('eV'),reference:'',note});

export const materials = [
  semiconductor('Si','硅 Si','#677782','unknown',1.12,4.05,'https://www.ioffe.ru/SVA/NSM/Semicond/Si/','载流子类型由具体区域的掺杂决定；本示例的能量值仍标为 estimated。'),
  semiconductor('MoS2','二硫化钼 MoS₂','#55BFC4','n',1.8,4.2,'https://doi.org/10.1038/s41467-021-23711-x','n 型是配方初始假设；层数与缺陷会改变能带。'),
  semiconductor('WS2','二硫化钨 WS₂','#46A6AE','n',2.0,4.0,'https://doi.org/10.1038/srep10699'),
  semiconductor('WSe2','二硒化钨 WSe₂','#E5A15A','p',1.6,3.9,'https://doi.org/10.1021/acsnano.0c08075','可呈双极性；p 型需具体工艺或栅压支持。'),
  semiconductor('InON','氮氧化铟 InON','#61AFBE','n',null,null,'https://doi.org/10.1039/d3tc02835f','O/N 比与等离子体条件相关；不把材料名当作固定带隙或固定掺杂证据。'),
  semiconductor('Te','碲 Te','#D69564','p',0.35,4.5,'https://doi.org/10.1007/s40820-022-00852-2','带隙示例接近体材料；不能用于任意厚度的 tellurene 定量预测。'),
  {...conductor('graphene','石墨烯','#4F565D',4.5,'https://doi.org/10.1038/nature12385'),category:'semimetal',note:'半金属；不可自动代入有带隙半导体的 PN 模型。'},
  conductor('Au','金 Au','#E5A15A',5.1), conductor('Ti','钛 Ti','#8496A6',4.33),
  conductor('Al','铝 Al','#B3BEC6',4.28),conductor('Pt','铂 Pt','#B8B8AD',5.65),
  conductor('Pd','钯 Pd','#98A3AD',5.12),conductor('W','钨 W','#798188',4.55),
  {...conductor('ITO','氧化铟锡 ITO','#95CAD5',4.7,'https://doi.org/10.1002/aelm.201600529'),category:'tco',bandGap:{...estimate(3.7,'eV','光学带隙示例，不等同于输运带隙'),kind:'optical'},note:'透明导电氧化物；功函数、电阻率和透过率依赖氧分压、Sn 含量、厚度与退火。'},
  dielectric('SiO2','二氧化硅 SiO₂','#B5C5CF',9,3.9),
  dielectric('Al2O3','氧化铝 Al₂O₃','#77A8C4',8.8,9),
  dielectric('HfO2','氧化铪 HfO₂','#4B94BD',5.8,20),
  dielectric('hBN','六方氮化硼 h-BN','#A9C8D6',6,4),
  {...dielectric('glass','玻璃','#92A3AE',9,4),category:'substrate',note:'玻璃品类相关；此条只供几何衬底使用。'},
  {...dielectric('sapphire','蓝宝石','#86AAC0',8.8,9.4),category:'substrate'},
  {...resist('NR9-3000PY','negative','UV','RD6（具体条件待校准）','RR4 / 丙酮（需核对下层兼容性）','具体牌号负胶；官方技术资料给出 365 nm、150 °C/60 s 软烘、100 °C/60 s 曝光后烘烤与 RD6 显影参考。默认胶厚由配方填写。'),reference:'https://signupmonkey.ece.ucsb.edu/wiki/images/7/71/NR9-3000PY-revA.pdf'},
  resist('S1813','positive','UV','MF-319（工艺参考）','兼容溶剂（按膜层选择）','正胶；默认厚度和烘烤值为演示配方，不是厂商窗口。'),
  {...resist('AZ5214E','positive','UV','按厂商工艺','按厂商工艺','当前按正胶模式处理；反转模式需另加反转烘烤与泛曝光，尚未建模。'),reference:'https://www.microchemicals.com/dokumente/datenblaetter/tds/merck/en/tds_az_5214e_photoresist.pdf'},
  resist('PMMA950A4','positive','EBL','MIBK:IPA（工艺参考）','丙酮（须检查下层兼容性）','电子束胶；本模型只处理几何开口，不预测曝光剂量响应。'),
  resist('SU8','negative','UV','PGMEA（工艺参考）','交联后较难去除','通常用于永久结构；普通 lift-off 不是默认适用路线。'),
];
export const categoryNames = {semiconductor:'半导体',conductor:'金属',tco:'透明导体',semimetal:'半金属',dielectric:'介质',substrate:'衬底',resist:'光刻胶'};
export const evidenceNames = {measured:'实测',derived:'推导',estimated:'估算',missing:'缺失'};
export const gapKindNames = {unspecified:'未确定类型',optical:'光学带隙',quasiparticle:'准粒子带隙',transport:'输运带隙'};
export function bandDataIssue(m) {
  if(!['transport','quasiparticle'].includes(m?.bandGap?.kind))return m?.bandGap?.kind==='optical'?'光学带隙不能直接作为电子带隙':'带隙类型未确定';
  if(m?.affinity?.reference!=='vacuum')return '电子亲和能未确认为真空参考';
  if(![m.bandGap,m.affinity].every(p=>p.value!==null&&Number.isFinite(p.value)))return '电子带隙或电子亲和能缺失';
  if(m.bandGap.value<=0)return '电子带隙需为正值';
  return '';
}
export const isConductor = m => ['conductor','tco','semimetal'].includes(m?.category);
export const getMaterial = (items,id) => items.find(m=>m.id===id);
