import { materials } from './materials.js';

export const processTypes = {
  substrate:{label:'选择衬底',group:'衬底准备',short:'SUB',defaults:{material:'Si',waferInch:4,waferThicknessUm:525,oxideNm:285,backgate:false,doping:'p'}},
  dice:{label:'划片',group:'衬底准备',short:'DICE',defaults:{widthMm:10,lengthMm:10}},
  clean:{label:'表面清洁',group:'衬底准备',short:'CLN',defaults:{method:'溶剂清洗',durationS:60}},
  coat:{label:'旋涂光刻胶',group:'光刻与图形化',short:'PR',defaults:{material:'NR9-3000PY',thicknessNm:3000,rpm:3000}},
  bake:{label:'烘烤',group:'光刻与图形化',short:'BAKE',defaults:{temperatureC:100,durationS:60}},
  expose:{label:'曝光 / 对准',group:'光刻与图形化',short:'EXP',defaults:{pattern:'rect',widthUm:20,lengthUm:20,pitchUm:12,count:3,gapUm:8,offsetXUm:0,offsetYUm:0,invert:false}},
  develop:{label:'显影',group:'光刻与图形化',short:'DEV',defaults:{durationS:30}},
  deposit:{label:'薄膜 / 金属沉积',group:'材料形成',short:'DEP',defaults:{material:'Au',thicknessNm:50,method:'热蒸镀',role:'electrode',doping:'unknown',temperatureC:25}},
  transfer:{label:'薄膜转移',group:'材料形成',short:'TRF',defaults:{material:'MoS2',thicknessNm:1,role:'channel',doping:'n',widthUm:26,lengthUm:18,offsetXUm:0,offsetYUm:0}},
  etch:{label:'选择性刻蚀',group:'刻蚀与后处理',short:'ETCH',defaults:{material:'HfO2',method:'RIE',durationS:20,rateNmS:1,rateEvidence:'estimated',rateSource:''}},
  liftoff:{label:'金属剥离 lift-off',group:'刻蚀与后处理',short:'LIFT',defaults:{durationS:300}},
  strip:{label:'去胶',group:'刻蚀与后处理',short:'STRIP',defaults:{durationS:60}},
  anneal:{label:'退火',group:'刻蚀与后处理',short:'ANN',defaults:{temperatureC:150,durationS:1800,atmosphere:'N₂'}},
};
export const patterns={rect:'矩形开口','stripe-x':'横向线条','stripe-y':'纵向线条','array-x':'横向阵列','array-y':'纵向阵列',contacts:'源漏双开口',all:'整面'};
export const roles={electrode:'普通电极',contacts:'源漏电极（按左右分配）',source:'源极 / 左端',drain:'漏极 / 右端',gate:'栅极',channel:'沟道',active:'活性层',none:'无指定端子'};
export function step(type,params={},name) {
  return {id:crypto.randomUUID(),type,name:name||processTypes[type].label,enabled:true,params:{...structuredClone(processTypes[type].defaults),...params}};
}
function metal(name,pattern,params={}) {
  return [step('coat',{},`${name} · 涂胶`),step('bake'),step('expose',pattern,`${name} · 曝光`),step('develop'),step('deposit',params,`${name} · 沉积`),step('liftoff',{},`${name} · 剥离`)];
}
function etchMask(name,mask,params) {
  return [step('coat',{},`${name} · 涂胶`),step('bake'),step('expose',mask,`${name} · 曝光`),step('develop'),step('etch',params,name),step('strip')];
}
export const templateNames={crossbar:'二端交叉阵列',backgate:'全局底栅晶体管',topgate:'局部顶栅晶体管',pn:'Te / InON 异质结',blank:'空白工艺'};
export function createProject(template='crossbar') {
  let steps=[step('substrate',{backgate:template==='backgate'}),step('dice'),step('clean')];
  if(template==='crossbar') steps.push(
    // ponytail: keep the step below dielectric thickness; conformal sidewall ALD needs a fuller geometry model.
    ...metal('底电极',{pattern:'array-x',widthUm:6,lengthUm:36},{material:'Pt',thicknessNm:10}),
    step('deposit',{material:'HfO2',thicknessNm:12,role:'active',method:'ALD'},'HfO₂ 活性层'),
    ...etchMask('活性层隔离',{pattern:'rect',widthUm:36,lengthUm:36,invert:true},{material:'HfO2',rateNmS:1,durationS:14}),
    ...metal('顶电极',{pattern:'array-y',widthUm:6,lengthUm:36},{material:'Au',thicknessNm:50}),
  );
  if(template==='backgate'||template==='topgate') {
    steps.push(step('transfer'),...metal('源漏电极',{pattern:'contacts',widthUm:18,lengthUm:24,gapUm:8},{material:'Au',thicknessNm:50,role:'contacts'}));
    if(template==='topgate') steps.push(
      step('deposit',{material:'Al2O3',thicknessNm:25,role:'none',method:'ALD'},'顶栅介质 Al₂O₃'),
      ...etchMask('源漏接触窗',{pattern:'contacts',widthUm:14,lengthUm:22,gapUm:10},{material:'Al2O3',durationS:25,rateNmS:1}),
      ...metal('顶栅',{pattern:'stripe-y',widthUm:6,lengthUm:26},{material:'Al',thicknessNm:50,role:'gate'}),
    );
    steps.push(step('anneal'));
  }
  if(template==='pn') steps.push(
    step('transfer',{material:'Te',doping:'p',role:'active',thicknessNm:20,widthUm:20,lengthUm:20,offsetXUm:-4},'p-Te 薄膜转移'),
    step('transfer',{material:'InON',doping:'n',role:'active',thicknessNm:15,widthUm:20,lengthUm:20,offsetXUm:4},'n-InON 薄膜转移'),
    ...metal('Te 端电极',{pattern:'rect',widthUm:4,lengthUm:16,offsetXUm:-12},{material:'Au',role:'source'}),
    ...metal('InON 端电极',{pattern:'rect',widthUm:4,lengthUm:16,offsetXUm:12},{material:'Au',role:'drain'}),
  );
  if(template==='blank') steps=[step('substrate')];
  return {version:1,name:templateNames[template]||templateNames.blank,template,sizeUm:40,resolution:40,materials:structuredClone(materials),steps};
}
