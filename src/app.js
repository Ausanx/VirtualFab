import { createProject,processTypes,templateNames,patterns,roles,step } from './recipes.js';
import { categoryNames,evidenceNames,gapKindNames,getMaterial } from './materials.js';
import { simulate,validateProject,compareGrids } from './engine.js';
import { analyze,diodeCurve } from './physics.js';
import { interfaceKey,profilesFor } from './interfaces.js';
import { equilibriumDefaults,validateEquilibrium,assessEquilibrium } from './equilibrium.js';
import { DevicePhysicsUI } from './device-ui.js';
import { siliconBenchmark } from './device-model.js';
import { StructureViewer,drawSlice,drawBands,drawInterfaceBands,drawEquilibrium,drawCurve,escapeHtml as esc } from './viewer.js';
import SplitGrid from 'split-grid';
import { AtomicUI } from './atomic-ui.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const STORAGE='virtualfab.project.v1',LIBRARY='virtualfab.materials.v1';
let project=createProject('crossbar'),restoreError='',restored=false;
try{const saved=localStorage.getItem(STORAGE);if(saved){const parsed=JSON.parse(saved);validateProject(parsed);project=parsed;restored=true;}}catch(error){restoreError=`本地项目读取失败，已加载示例；原存档尚未覆盖。${error.message}`;}
let selected=project.steps.length-1,through=selected,sliceIndex=Math.floor(project.resolution/2),state,result,viewer,timer=null,materialId=project.materials[0].id,curveRows=[],confirmAction=null;
let savedSnapshot=restored?null:JSON.stringify(project),projectFile='';
let equilibriumResult=null,equilibriumGeneration=0,equilibriumRunning=false;
let atomicUI,deviceUI,manualResult=null,deviceResult=null;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function hasUnsavedChanges(){return savedSnapshot!==JSON.stringify(project);}
function updateSaveStatus(){
  const dirty=hasUnsavedChanges(),status=$('#save-status');
  status.textContent=dirty?'未保存更改':projectFile?`${window.virtualFabFiles?'已保存':'已打开'} · ${projectFile.split(/[\\/]/).at(-1)}`:'尚未保存到文件';
  status.title=projectFile||'自动恢复副本保存在本机；请保存项目文件。';
  const dot=$('.project-name .status-dot');dot.classList.toggle('dirty',dirty);dot.title=status.textContent;dot.setAttribute('aria-label',status.textContent);
  document.title=`${dirty?'* ':''}${project.name} - VirtualFab Studio`;
}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(project));updateSaveStatus();}catch{$('#save-status').textContent='自动备份失败 · 请保存';toast('本地自动备份不可用，请保存项目文件。');}}
function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
function download(name,text,type='application/json',metadata){
  if(metadata&&window.virtualFabFiles?.exportPhysicsCsv){window.virtualFabFiles.exportPhysicsCsv(name,text,JSON.stringify(metadata)).then(saved=>{if(saved)toast('CSV 与配套元数据已导出。');}).catch(error=>toast('导出失败：'+error.message));return;}
  if(type==='text/csv'&&window.virtualFabFiles?.exportCsv){
    window.virtualFabFiles.exportCsv(name,text).then(saved=>{if(saved)toast('CSV 数据已导出。');}).catch(error=>toast('导出失败：'+error.message));return;
  }
  if(name==='si-equilibrium-result.json'&&window.virtualFabFiles?.exportResult){window.virtualFabFiles.exportResult(name,text).then(saved=>{if(saved)toast('结果档案已导出。');}).catch(error=>toast('导出失败：'+error.message));return;}
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  if(metadata)download(name+'.metadata.json',JSON.stringify(metadata,null,2)+'\n');
}
async function saveProject(saveAs=false){
  try{
    validateProject(project);
    if(window.virtualFabFiles){
      const snapshot=JSON.stringify(project),saved=await window.virtualFabFiles.save(project,saveAs);
      if(!saved)return false;
      projectFile=saved.path;savedSnapshot=snapshot;updateSaveStatus();toast('项目已保存。');return true;
    }
    download((project.name.replace(/[<>:"/\\|?*]/g,'_')||'VirtualFab')+'.json',JSON.stringify(project,null,2));
    toast('项目 JSON 已开始下载，请检查下载文件。');return true;
  }catch(error){toast('保存失败：'+error.message);return false;}
}
function confirm(title,text,action,saveFirst=false){
  $('#confirm-title').textContent=title;$('#confirm-text').textContent=text;confirmAction=action;
  $('#confirm-save').hidden=!saveFirst||!window.virtualFabFiles;
  $('#confirm-ok').textContent=saveFirst?'不保存并继续':'继续';
  $('#confirm-dialog').showModal();
}
function stop(){if(timer){clearInterval(timer);timer=null;}$('#play').textContent='▶';$('#play').setAttribute('aria-label','播放工艺');}
function applyChange(next,nextSelected=selected,nextThrough=through){try{validateProject(next);project=next;selected=nextSelected;through=nextThrough;persist();render();return true;}catch(error){toast(error.message);return false;}}
const descriptions={substrate:'选择真实晶圆尺寸。微米级局部窗口单独计算，硅片底部在视图中截断。',dice:'矩形芯片尺寸将检查是否能放入所选圆形晶圆。',clean:'记录清洁条件与顺序；材料兼容性需匹配工艺数据。',coat:'光刻胶牌号决定正负性。当前膜厚由输入给定，转速不自动推导膜厚。',bake:'记录软烘或曝光后烘烤；零时长无效，NR9-3000PY 偏离厂商参考条件会提示未验证。首版不计算交联程度。',expose:'图案定义“显影后的目标开口”。同一胶层的多次曝光会累积；负胶会反转曝光区，显影时才移除胶。',develop:'根据当前胶的正负性与曝光结果生成实际开口。',deposit:'按顶表面沉积膜厚。用于估计层叠与开口填充；侧壁通量和成核尚未求解。',transfer:'以矩形区域放置薄膜，保留厚度和载流子类型；不模拟转移应力与残留。',etch:'按速率 × 时间消耗指定外露材料。其他材料速率未知时保留并提示。',liftoff:'移除已显影光刻胶及其上方的沉积物，保留开口内沉积层；非定向沉积时需核实侧壁连膜。',strip:'去除当前胶层；上方有沉积物时应使用 lift-off。',anneal:'记录温度、时间与气氛；未有标定模型时不自动改变能带或载流子。'};
const fields={
 material:'材料 / 牌号',waferInch:'晶圆直径 (inch)',waferThicknessUm:'晶圆厚度 (μm)',oxideNm:'表面 SiO₂ 厚度 (nm)',backgate:'重掺杂 Si 用作全局背栅',doping:'区域载流子类型',widthMm:'划片宽度 (mm)',lengthMm:'划片长度 (mm)',method:'工艺方式',durationS:'处理时间 (s)',thicknessNm:'厚度 (nm)',rpm:'旋涂转速 (rpm)',temperatureC:'温度 (°C)',pattern:'显影后开口图案',widthUm:'宽度 (μm)',lengthUm:'长度 (μm)',pitchUm:'阵列间距 (μm)',count:'线条数量',gapUm:'源漏间隙 (μm)',offsetXUm:'X 偏移 (μm)',offsetYUm:'Y 偏移 (μm)',invert:'开口取图形的外部（用于刻蚀隔离）',role:'器件中的角色',rateNmS:'垂直刻蚀速率 (nm/s)',rateEvidence:'速率证据',rateSource:'来源与适用条件',atmosphere:'气氛',
};
function options(values,current){return Object.entries(values).map(([key,label])=>`<option value="${esc(key)}"${String(key)===String(current)?' selected':''}>${esc(label)}</option>`).join('');}
function materialOptions(type){return Object.fromEntries(project.materials.filter(m=>type==='coat'?m.category==='resist':type==='substrate'?['Si','glass','sapphire'].includes(m.id):!['resist','substrate'].includes(m.category)).map(m=>[m.id,m.name]));}
function fieldHtml(key,value,s){
  let choices=null;
  if(key==='material')choices=materialOptions(s.type);
  if(key==='doping')choices={unknown:'未知 / 未确定',n:'n 型（配方假设）',p:'p 型（配方假设）',i:'本征 / 低掺杂（配方假设）'};
  if(key==='pattern')choices=patterns;
  if(key==='role')choices=roles;
  if(key==='waferInch')choices={2:'2 inch',3:'3 inch',4:'4 inch',6:'6 inch',8:'8 inch',12:'12 inch'};
  if(key==='rateEvidence')choices={estimated:'估算',measured:'实测',derived:'推导'};
  if(key==='method'&&s.type==='deposit')choices={'热蒸镀':'热蒸镀','电子束蒸镀':'电子束蒸镀','溅射':'溅射（顶表面近似）',ALD:'ALD（顶表面近似）',CVD:'CVD（顶表面近似）'};
  if(key==='method'&&s.type==='etch')choices={RIE:'RIE / 垂直刻蚀','湿法':'湿法（只算垂直厚度）'};
  if(typeof value==='boolean')return `<label class="check-label"><input type="checkbox" name="${key}"${value?' checked':''}>${esc(fields[key]||key)}</label>`;
  return `<label>${esc(fields[key]||key)}${choices?`<select name="${key}">${options(choices,value)}</select>`:`<input name="${key}" type="${typeof value==='number'?'number':'text'}" ${typeof value==='number'?'step="any"':''} value="${esc(value)}"${key==='rateSource'?'':' required'} maxlength="2000">`}</label>`;
}
function maskPreviewHtml(s){
  if(!['expose','develop'].includes(s.type)||state.completed<selected||!state.activeResist||!state.lastPattern)return '';
  if(s.type==='expose'&&state.lastPattern.stepId!==s.id)return '';
  const developed=s.type==='develop';
  return `<section class="mask-preview" aria-label="掩膜采样预览"><div class="mask-preview-heading"><strong>开口预览</strong><span>采样间距 ${(project.sizeUm/project.resolution).toFixed(2)} μm</span></div><div class="mask-preview-grid"><figure><canvas id="mask-target" width="${project.resolution}" height="${project.resolution}" role="img" aria-label="最近一次目标开口"></canvas><figcaption>${developed?'最近一次':'本次'}目标开口</figcaption></figure><figure><canvas id="mask-result" width="${project.resolution}" height="${project.resolution}" role="img" aria-label="${developed?'显影实际开口':'累计预计开口'}"></canvas><figcaption>${developed?'显影实际开口':'累计预计开口'}</figcaption></figure></div><p>蓝色为开口 · 理想几何采样，不预测光学成像</p></section>`;
}
function drawMaskPreview(){
  const target=$('#mask-target');if(!target)return;
  const resist=state.activeResist,tone=getMaterial(project.materials,resist.material).tone;
  const result=state.cells.map(c=>{const layer=c.find(l=>l.stepId===resist.id);return resist.developed?!layer:(tone==='positive'?Boolean(layer?.exposed):!layer?.exposed);});
  for(const [canvas,pixels]of [[target,state.lastPattern.openings],[$('#mask-result'),result]]){
    const image=canvas.getContext('2d').createImageData(canvas.width,canvas.height);
    pixels.forEach((open,i)=>{const at=i*4,color=open?[47,127,174]:[227,232,238];image.data.set([...color,255],at);});
    canvas.getContext('2d').putImageData(image,0,0);
  }
}
function renderParams(){
  const s=project.steps[selected];if(!s){$('#params-panel').innerHTML='<p class="empty-message">从左侧添加工艺卡片，或选择已有步骤。</p>';return;}
  $('#params-panel').innerHTML=`<div class="step-tag"><span>${String(selected+1).padStart(2,'0')}</span><span>/</span><span>${processTypes[s.type].short}</span><span class="badge">${s.enabled?'已启用':'已禁用'}</span></div><h2 class="inspector-title">${esc(processTypes[s.type].label)}</h2><details class="step-description"><summary>工艺模型说明</summary><p>${esc(descriptions[s.type])}</p></details>${maskPreviewHtml(s)}<form id="param-form" class="param-form"><label>步骤名称<input name="stepName" value="${esc(s.name)}" maxlength="120" required></label>${Object.entries(s.params).filter(([k])=>k in processTypes[s.type].defaults).map(([k,v])=>fieldHtml(k,v,s)).join('')}<label class="check-label"><input name="stepEnabled" type="checkbox"${s.enabled?' checked':''}>启用此步骤</label><button type="submit" class="primary">应用参数并重算</button></form><hr class="section-line"><div class="card-actions"><button data-action="up"${selected===0?' disabled':''}>↑ 前移</button><button data-action="down"${selected===project.steps.length-1?' disabled':''}>↓ 后移</button><button data-action="duplicate">复制步骤</button><button data-action="delete" class="remove"${project.steps.length<=1?' disabled':''}>删除步骤</button></div>`;
  drawMaskPreview();
  $('#param-form').addEventListener('submit',e=>{
    e.preventDefault();stop();const next=structuredClone(project),target=next.steps[selected],data=new FormData(e.target);
    target.name=String(data.get('stepName')).trim();target.enabled=data.has('stepEnabled');
    for(const [key,value]of Object.entries(processTypes[target.type].defaults))target.params[key]=typeof value==='number'?Number(data.get(key)):typeof value==='boolean'?data.has(key):String(data.get(key));
    if(applyChange(next))toast('参数已应用，结构已重新计算。');
  });
  $$('#params-panel [data-action]').forEach(b=>b.onclick=()=>cardAction(b.dataset.action));
}
function cardAction(action){stop();const next=structuredClone(project);let nextSelected=selected;
  if(action==='delete'){next.steps.splice(selected,1);nextSelected=Math.max(0,selected-1);}
  if(action==='duplicate'){const copy=structuredClone(next.steps[selected]);copy.id=crypto.randomUUID();copy.name+=' · 副本';next.steps.splice(selected+1,0,copy);nextSelected++;}
  if(action==='up'||action==='down'){const to=selected+(action==='up'?-1:1);[next.steps[selected],next.steps[to]]=[next.steps[to],next.steps[selected]];nextSelected=to;}
  applyChange(next,nextSelected,nextSelected);
}
function stepSummary(s){const p=s.params;if(p.thicknessNm)return `${p.material} · ${p.thicknessNm} nm`;if(s.type==='substrate')return `${p.waferInch}″ ${p.material}${p.oxideNm?' / SiO₂':''}`;if(s.type==='expose')return patterns[p.pattern];if(s.type==='etch')return `${p.material} · ${p.durationS} s`;if(p.temperatureC)return `${p.temperatureC} °C · ${p.durationS} s`;return p.durationS?`${p.durationS} s`:s.type==='dice'?`${p.widthMm} × ${p.lengthMm} mm`:'';}
function revealCurrentStep(){
  const strip=$('#recipe-cards'),current=strip.querySelector('.recipe-card.current');
  if(!current)return;
  const bounds=current.getBoundingClientRect(),viewport=strip.getBoundingClientRect();
  if(bounds.left<viewport.left)strip.scrollLeft+=bounds.left-viewport.left;
  else if(bounds.right>viewport.right)strip.scrollLeft+=bounds.right-viewport.right;
}
function renderCards(){
  const strip=$('#recipe-cards'),oldScroll=strip.scrollLeft;
  strip.innerHTML=project.steps.map((s,i)=>`<button class="recipe-card${i===selected?' current':''}${s.enabled?'':' disabled'}" draggable="true" data-index="${i}" aria-label="步骤 ${i+1} ${esc(s.name)}" aria-current="${i===selected?'step':'false'}"><div class="recipe-top"><span>${String(i+1).padStart(2,'0')} · ${processTypes[s.type].short}</span><span>${state.stoppedAt===i?'!':i<=state.completed&&s.enabled?'✓':'○'}</span></div><strong>${esc(s.name)}</strong><small>${esc(stepSummary(s))}</small></button>`).join('');
  strip.scrollLeft=oldScroll;
  revealCurrentStep();
  $$('.recipe-card').forEach(b=>{
    b.onclick=()=>selectStep(Number(b.dataset.index));
    b.ondragstart=e=>{e.dataTransfer.setData('text/plain',b.dataset.index);e.dataTransfer.effectAllowed='move';};
    b.ondragover=e=>{e.preventDefault();b.classList.add('drag-over');};b.ondragleave=()=>b.classList.remove('drag-over');
    b.ondrop=e=>{e.preventDefault();stop();const from=Number(e.dataTransfer.getData('text/plain')),to=Number(b.dataset.index);if(!Number.isInteger(from)||from<0||from>=project.steps.length)return;const next=structuredClone(project),[moved]=next.steps.splice(from,1);next.steps.splice(to,0,moved);applyChange(next,to,to);};
  });
  $('#step-counter').textContent=`${through<0?'起点':`第 ${through+1} 步`} / ${project.steps.length} 步`;
  $('#previous-step').disabled=through<0;$('#first-step').disabled=through<0;$('#next-step').disabled=through>=project.steps.length-1;
}
function selectStep(i,{playing=false}={}){if(!playing)stop();through=Math.max(-1,Math.min(i,project.steps.length-1));selected=Math.max(0,through);render();$(`.recipe-card[data-index="${selected}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});}
function renderResults(){
  const issues=state.diagnostics.filter(d=>d.severity!=='info');$('#diagnostic-count').textContent=issues.length?issues.length:'';
  const notices=state.diagnostics.filter(d=>d.severity==='info');
  const diagnosticHtml=d=>`<div class="diagnostic ${d.severity}"><button data-diag-step="${d.index}">步骤 ${d.index+1} · ${d.severity==='error'?'停止':d.severity==='info'?'模型说明':'需核实'} ↗</button><p>${esc(d.message)}</p></div>`;
  $('#results-panel').innerHTML=`<h3>结构识别</h3><p class="result-summary">${result.structures.length} 类候选结构 · ${issues.length} 项工艺检查</p>${result.structures.length?result.structures.map(s=>`<article class="structure-result"><span class="badge">${esc(s.code)}</span><h3>${esc(s.title)}</h3><p class="materials">${s.materials.map(esc).join(' / ')}</p>${s.evidence.map(t=>`<p>${esc(t)}</p>`).join('')}<details><summary>查看 ${s.missing.length} 项待核实条件</summary><ul>${s.missing.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></details></article>`).join(''):'<p class="empty-message">当前步骤尚未形成可识别结构。</p>'}<div class="diagnostic-heading"><h3>工艺检查</h3><span>${issues.length}</span></div>${issues.length?issues.map(diagnosticHtml).join(''):'<p class="empty-message">当前无工艺警告</p>'}${notices.length?`<details class="model-notices"><summary>模型说明 · ${notices.length}</summary>${notices.map(diagnosticHtml).join('')}</details>`:''}`;
  $$('[data-diag-step]').forEach(b=>b.onclick=()=>{selectStep(Number(b.dataset.diagStep));setPanel('params');});
}
function setPanel(panel){$$('[data-panel]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.panel===panel)));$('#params-panel').hidden=panel!=='params';$('#results-panel').hidden=panel!=='results';}
function renderViews(){
  let scale={gain:1};try{if(viewer)scale=viewer.update(state,project.materials,sliceIndex);}catch(error){toast('三维视图未能更新：'+error.message);}
  $('#scale-label').textContent=viewer?.wafer?`${state.substrate?.waferInch||'—'} inch 晶圆 · 中心框为划片示意`:`功能层 Z ×${scale.gain.toFixed(1)} · 衬底示意截断`;
  const ids=[...new Set(state.cells.flat().map(l=>l.material))];
  $('#layer-legend').innerHTML=ids.map(id=>{const m=getMaterial(project.materials,id);return `<span class="legend-item"><i class="swatch" style="background:${m.color}"></i>${esc(m.name)}</span>`;}).join('')||'<span>尚未执行衬底步骤</span>';
  drawSlice($('#slice-plot'),state,project.materials,sliceIndex);
  drawBands($('#band-diagram'),state,project.materials);
  renderInterfaces();
  const y=(sliceIndex+.5)*project.sizeUm/project.resolution-project.sizeUm/2;$('#slice-value').textContent=y.toFixed(1);$('#slice-range').max=project.resolution-1;$('#slice-range').value=sliceIndex;
}
function renderInterfaces(){
  $('#interface-results').innerHTML=result.interfaces.map((i,index)=>{
    const selection=project.interfaceSelections?.find(s=>interfaceKey(s.a,s.b)===interfaceKey(i.a,i.b)),profiles=profilesFor(i.a,i.b);
    const numeric=i.type==='unknown'?'带阶数据不足':`Type-${i.type} · ΔEc ${i.deltaEc.toFixed(2)}${i.deltaEcError?` ± ${i.deltaEcError.toFixed(2)}`:''} eV · ΔEv ${i.deltaEv.toFixed(2)}${i.deltaEvError?` ± ${i.deltaEvError.toFixed(2)}`:''} eV`;
    const profile=profiles.find(p=>p.id===selection?.profileId);
    return `<section class="interface-detail"><div class="interface-row"><strong>${esc(i.a)} → ${esc(i.b)}</strong><span>${numeric}</span></div><p class="view-note">${esc(i.note)}</p>${profiles.length?`<div class="interface-controls"><label>界面数据<select data-interface-index="${index}">${options({'':'材料真空近似',...Object.fromEntries(profiles.map(p=>[p.id,p.name]))},selection?.profileId||'')}</select></label>${profile?`<label class="check-label"><input type="checkbox" data-interface-confirm="${index}"${selection.conditionsConfirmed?' checked':''}>样品及测量条件与档案一致</label>`:''}</div>`:''}${profile?`<details class="interface-conditions"><summary>来源与适用条件</summary><p>${esc(profile.conditions)}</p><p>${esc(profile.note)}</p><a href="${esc(profile.source)}" target="_blank" rel="noopener noreferrer">Chiu 2015 · DOI ↗</a></details>`:''}${i.reference==='relative-interface'?`<div class="interface-relative-label">相对参考 · Ev(${esc(i.a)}) = 0 · 非真空能级</div><div class="interface-band-plot" data-relative-plot="${index}"></div>`:''}</section>`;
  }).join('')||'<p class="empty-message">当前结构没有半导体接触界面。</p>';
  $$('[data-relative-plot]').forEach(el=>drawInterfaceBands(el,result.interfaces[Number(el.dataset.relativePlot)],project.materials));
  function setSelection(index,profileId,conditionsConfirmed){
    const i=result.interfaces[index],next=structuredClone(project);
    next.interfaceSelections=(next.interfaceSelections||[]).filter(s=>interfaceKey(s.a,s.b)!==interfaceKey(i.a,i.b));
    if(profileId)next.interfaceSelections.push({a:i.a,b:i.b,profileId,conditionsConfirmed});
    applyChange(next);
  }
  $$('[data-interface-index]').forEach(el=>el.onchange=()=>setSelection(Number(el.dataset.interfaceIndex),el.value,false));
  $$('[data-interface-confirm]').forEach(el=>el.onchange=()=>{
    const i=result.interfaces[Number(el.dataset.interfaceConfirm)],s=project.interfaceSelections.find(s=>interfaceKey(s.a,s.b)===interfaceKey(i.a,i.b));
    setSelection(Number(el.dataset.interfaceConfirm),s.profileId,el.checked);
  });
}
function invalidateEquilibrium(){
  equilibriumGeneration++;manualResult=null;
  if($('#equilibrium-source').value==='device')return;
  equilibriumResult=null;$('#export-equilibrium').disabled=true;$('#export-equilibrium-meta').disabled=true;
  $('#equilibrium-summary').innerHTML='';$('#equilibrium-plot').innerHTML='';
  $('#equilibrium-status').textContent='尚未求解';
}
function renderEquilibriumConfig(){
  const config=project.equilibrium||equilibriumDefaults;
  for(const el of $$('#equilibrium-form input'))el.value=config[el.name];
  $('#equilibrium-settings').open=true;
  $('#solve-equilibrium').disabled=!window.virtualFabPhysics||equilibriumRunning;
  if(!window.virtualFabPhysics)$('#equilibrium-status').textContent='本地物理求解器仅在桌面版运行。';
}
function renderEquilibriumResult(){
  if(!equilibriumResult){$('#equilibrium-summary').innerHTML='';$('#equilibrium-plot').innerHTML='';$('#export-equilibrium').disabled=true;$('#export-equilibrium-meta').disabled=true;$('#equilibrium-status').textContent='尚未求解';return;}
  const r=equilibriumResult,o=r.oracle,m=r.meshCheck;
  $('#equilibrium-status').textContent=`${r.history?'历史结果 · ':''}DEVSIM ${r.solverVersion} · 已收敛 · ${r.rows.length} 个节点 · ${r.config.intrinsicLengthUm?'PIN':'PN'}${r.accuracyPassed===false?' · 精度检查未通过':''}`;
  $('#equilibrium-summary').innerHTML=`<table class="data-table"><thead><tr><th>量</th><th>数值解</th><th>耗尽近似</th></tr></thead><tbody><tr><td>内建电势 (V)</td><td>${r.builtInV.toFixed(5)}</td><td>${o.builtInV.toFixed(5)}</td></tr><tr><td>峰值电场 (V/cm)</td><td>${r.peakFieldVcm.toExponential(3)}</td><td>${o.peakFieldVcm.toExponential(3)}</td></tr></tbody></table><p class="view-note">${m.requestedNm} → ${m.returnedNm} nm：电势差 ${(1000*m.potentialDifferenceV).toFixed(3)} mV；峰值电场变化 ${(100*m.peakFieldRelativeDifference).toFixed(2)}%。${m.withinTolerance?'网格检查通过':'网格需加密'}。</p>${r.warnings.map(w=>`<p class="error-message">${esc(w)}</p>`).join('')}<details class="physics-conditions"><summary>模型参数与边界条件</summary><p>独立的一维体硅同质结；完全电离、Boltzmann 统计、理想欧姆端部、零偏压。i 区为本征硅。当前三维工艺未映射到本算例。</p><p>Eg = ${r.parameters.gapEv} eV；εr = ${r.parameters.relativePermittivity}；Nc = ${r.parameters.ncCm3.toExponential(2)}、Nv = ${r.parameters.nvCm3.toExponential(2)} cm⁻³；ni = ${r.parameters.niCm3.toExponential(3)} cm⁻³，由带隙与态密度一致推导。能量参考 EF = 0。</p><p>解析式采用耗尽近似，数值解保留移动电荷，两者不要求完全相等。未包含异质界面、钉扎、复合、光生或简并统计。</p></details>`;
  if(r.mapping){
    const note=$('#equilibrium-summary .physics-conditions p');note.textContent=`由步骤 ${r.mapping.through+1} 的硅几何映射；${r.mapping.axis.toUpperCase()} 路径 ${r.mapping.path.startUm} → ${r.mapping.path.endUm} μm；给定分段掺杂，完全电离、无补偿、300 K、Boltzmann 统计。起点：${r.mapping.boundaries.start.assumption}。终点：${r.mapping.boundaries.end.assumption}。工艺未预测掺杂或真实接触势垒。`;
  }
  if(r.validation){
    const b=r.validation.boundary;
    if(b)$('#equilibrium-summary').insertAdjacentHTML('beforeend',`<details class="physics-conditions"><summary>边界适用性 · ${b.state==='passed'?'通过':'未通过'}</summary><p>${esc(b.method)}：p 侧 ${(100*b.pDepletionFraction).toFixed(1)}%，n 侧 ${(100*b.nDepletionFraction).toFixed(1)}%；两侧均须低于各自区域长度的 ${(100*b.limit).toFixed(0)}%。</p><p>${esc(b.note)}</p></details>`);
    $('#equilibrium-summary').insertAdjacentHTML('beforeend',`<details class="physics-conditions"><summary>分项验证 · 实验标定未检查</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>检查</th><th>数值</th><th>限值</th><th>状态</th></tr></thead><tbody>${[...r.validation.algorithm,...r.validation.numerical].map(c=>`<tr><td>${esc(c.quantity)}</td><td>${c.value.toExponential(3)}</td><td>${c.limit.toExponential(2)}</td><td>${c.state==='passed'?'通过':'未通过'}</td></tr>`).join('')}</tbody></table></div><p>文献对照：未检查；实验标定：未检查。当前阈值属于此模型的工程验收条件。</p></details>`);
  }
  if(r.depletion){const d=r.depletion.thresholds[1];$('#equilibrium-summary').insertAdjacentHTML('beforeend',`<details class="physics-conditions"><summary>耗尽区操作定义与阈值敏感性</summary><p>${esc(r.depletion.definition)}</p><table class="data-table"><thead><tr><th>多数载流子阈值</th><th>p 侧宽度 (μm)</th><th>n 侧宽度 (μm)</th><th>含 i 区跨度 (μm)</th></tr></thead><tbody>${r.depletion.thresholds.map(t=>`<tr><td>${t.fraction}</td><td>${t.pWidthUm?.toFixed(4)??'未识别'}</td><td>${t.nWidthUm?.toFixed(4)??'未识别'}</td><td>${t.spanUm?.toFixed(4)??'未识别'}</td></tr>`).join('')}</tbody></table>${d.pBoundary.touchesBoundary||d.nBoundary.touchesBoundary?'<p class="error-message">数值判据触及计算域端部，不能当作远端中性耗尽宽度。</p>':''}</details>`);}
  drawEquilibrium($('#equilibrium-plot'),r,$('#equilibrium-quantity').value);$('#export-equilibrium').disabled=false;$('#export-equilibrium-meta').disabled=false;
}
function render(){
  const start=performance.now();state=simulate(project,through);result=analyze(state,project.materials,project.interfaceSelections);const elapsed=performance.now()-start;
  $('#project-name').value=project.name;updateSaveStatus();$('#material-count').textContent=`${project.materials.length} 种材料`;
  $('#model-label').textContent=$('[data-view][aria-selected="true"]').dataset.view==='atomic'?'原子晶胞 · Å':`局部区域 · ${project.sizeUm} × ${project.sizeUm} μm`;$('#elapsed').textContent=`计算 ${elapsed.toFixed(0)} ms`;
  $('#simulation-status').textContent=state.stoppedAt!==null?`步骤 ${state.stoppedAt+1} 停止 · 查看诊断`:'几何计算完成';
  renderCards();renderParams();renderResults();renderViews();
  deviceUI?.updateGeometry();
}
function renderLibrary(){
  const search=$('#process-search').value.toLowerCase(),groups={};
  for(const [type,data]of Object.entries(processTypes)){if(!`${data.label} ${data.short}`.toLowerCase().includes(search))continue;(groups[data.group]??=[]).push({type,...data});}
  $('#process-library').innerHTML=Object.entries(groups).map(([name,items])=>`<div class="process-group"><h3>${esc(name)}</h3>${items.map(i=>`<button class="process-item" data-add="${i.type}" aria-label="添加${esc(i.label)}"><span class="process-glyph">${i.short}</span><span>${esc(i.label)}</span><span>＋</span></button>`).join('')}</div>`).join('')||'<p class="empty-message">没有匹配的工艺</p>';
  $$('[data-add]').forEach(b=>b.onclick=()=>{stop();const next=structuredClone(project),nextSelected=selected+1;next.steps.splice(nextSelected,0,step(b.dataset.add));if(applyChange(next,nextSelected,nextSelected)){setPanel('params');$(`.recipe-card[data-index="${selected}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});}});
}
function renderMaterialList(){
  const search=$('#material-search').value.toLowerCase();
  $('#material-list').innerHTML=project.materials.filter(m=>`${m.id} ${m.name} ${categoryNames[m.category]}`.toLowerCase().includes(search)).map(m=>`<button class="material-row${m.id===materialId?' selected':''}" data-material="${esc(m.id)}"><i class="swatch" style="background:${m.color}"></i><span>${esc(m.name)}<small>${categoryNames[m.category]}</small></span></button>`).join('');
  $$('[data-material]').forEach(b=>b.onclick=()=>{materialId=b.dataset.material;renderMaterialList();renderMaterialDetail();});
}
function renderMaterialDetail(isNew=false){
  const m=isNew?{id:'',name:'',category:'semiconductor',color:'#55BFC4',polarity:'unknown',tone:'positive',note:'用户自定义材料',reference:'',...Object.fromEntries(['bandGap','affinity','workFunction'].map(k=>[k,{value:null,evidence:'missing',source:'',note:''}]))}:getMaterial(project.materials,materialId);
  if(!m)return;
  $('#material-detail').scrollTop=0;
  const propertyLabels={bandGap:'带隙 Eɡ (eV)',affinity:'电子亲和能 χ (eV)',workFunction:'功函数 Φ (eV)'};
  $('#material-detail').innerHTML=`<form id="material-form"><div class="material-detail-heading"><h2>${isNew?'自定义材料':esc(m.name)}</h2><span class="badge">${isNew?'新条目':categoryNames[m.category]}</span></div><div class="material-info"><label>材料 ID<input name="id" maxlength="80" value="${esc(m.id)}" required${isNew?'':' readonly'}></label><label>显示名称<input name="name" maxlength="120" value="${esc(m.name)}" required></label><label>材料类别<select name="category">${options(categoryNames,m.category)}</select></label><label>初始载流子类型<select name="polarity">${options({unknown:'未知',n:'n 型',p:'p 型',i:'本征 / 低掺杂'},m.polarity)}</select></label><label>结构色<input name="color" type="color" value="${m.color}"></label><label>光刻胶正负性<select name="tone">${options({positive:'正胶',negative:'负胶'},m.tone||'positive')}</select></label></div><p class="view-note">“缺失”保留为空值。实测值必须填写来源和条件；来源为材料介绍时不能把示例数字改标为实测。</p>${Object.entries(propertyLabels).map(([key,label])=>`<div class="property-row"><label for="prop-${key}">${label}</label><input id="prop-${key}" name="${key}" type="number" step="any" min="0" max="30" value="${m[key].value??''}" aria-label="${label}"><select name="${key}-evidence" aria-label="${label}证据">${options(evidenceNames,m[key].evidence)}</select><div class="property-note"><input name="${key}-source" value="${esc(m[key].source||'')}" placeholder="来源 URL / DOI / 测量记录" aria-label="${label}来源" maxlength="2000"><input name="${key}-note" value="${esc(m[key].note||'')}" placeholder="厚度、温度、晶相及测量方法" aria-label="${label}条件" maxlength="2000"></div></div>`).join('')}<div class="material-info"><label>材料背景文献<input name="reference" value="${esc(m.reference||'')}" placeholder="https://doi.org/…" maxlength="2000"></label><label>材料说明<input name="note" value="${esc(m.note||'')}" maxlength="2000"></label></div>${m.method?`<p class="material-notes">曝光方式：${esc(m.method)}<br>显影参考：${esc(m.developer)}<br>去胶参考：${esc(m.remover)}</p>`:''}${safeUrl(m.reference)?`<a class="material-source" href="${esc(safeUrl(m.reference))}" target="_blank" rel="noopener noreferrer">查看材料背景文献 ↗</a>`:''}<p class="error-message" id="material-error"></p><div class="material-actions"><button class="primary" type="submit">${isNew?'加入本地材料库':'保存材料参数'}</button></div></form>`;
  for(const key of Object.keys(propertyLabels)){
    const input=$(`#material-form [name="${key}"]`),evidence=$(`#material-form [name="${key}-evidence"]`);
    evidence.onchange=()=>{input.disabled=evidence.value==='missing';if(input.disabled)input.value='';};
    input.disabled=evidence.value==='missing';
  }
  const energyTypes=document.createElement('div');energyTypes.className='material-info';
  energyTypes.innerHTML=`<label>带隙类型<select name="bandGap-kind">${options(gapKindNames,m.bandGap.kind||'unspecified')}</select></label><label>电子亲和能参考<select name="affinity-reference">${options({unspecified:'未确认参考',vacuum:'真空参考'},m.affinity.reference||'unspecified')}</select></label>`;
  $('#material-form .property-row').before(energyTypes);
  $('#material-form').onsubmit=e=>{
    e.preventDefault();const data=new FormData(e.target),next=structuredClone(project),updated=structuredClone(m);
    for(const key of ['id','name','category','polarity','color','tone','reference','note'])updated[key]=String(data.get(key)||'').trim();
    for(const key of Object.keys(propertyLabels)){
      const evidence=String(data.get(key+'-evidence')),raw=data.get(key);
      if(evidence!=='missing'&&(raw===null||String(raw).trim()==='')){$('#material-error').textContent='有证据等级的参数需要数值；未知时请选择“缺失”。';return;}
      updated[key]={...updated[key],value:evidence==='missing'?null:Number(raw),unit:'eV',evidence,source:String(data.get(key+'-source')),note:String(data.get(key+'-note'))};
    }
    updated.bandGap.kind=String(data.get('bandGap-kind'));updated.affinity.reference=String(data.get('affinity-reference'));
    if(isNew&&next.materials.some(a=>a.id===updated.id)){$('#material-error').textContent='材料 ID 已存在，请使用其他 ID。';return;}
    if(isNew)next.materials.push(updated);else next.materials[next.materials.findIndex(a=>a.id===m.id)]=updated;
    try{validateProject(next);}catch(error){$('#material-error').textContent=error.message;return;}
    project=next;materialId=updated.id;persist();try{localStorage.setItem(LIBRARY,JSON.stringify(project.materials));}catch{toast('项目已更新；材料库存储失败，请导出项目。');}
    render();renderMaterialList();renderMaterialDetail();toast('材料参数已保存；当前工艺已重算。');
  };
}

function activateProject(next,file=''){
  stop();try{localStorage.setItem(STORAGE+'.previous',JSON.stringify(project));}catch{}
  project=next;selected=project.steps.length-1;through=selected;sliceIndex=Math.floor(project.resolution/2);
  projectFile=file;savedSnapshot=JSON.stringify(project);$('#template').value=project.template||'blank';
  invalidateEquilibrium();renderEquilibriumConfig();persist();render();
  atomicUI?.updateProject();
  deviceResult=null;deviceUI?.updateProject();$('#equilibrium-source').value=project.devicePhysics?'device':'manual';updateEquilibriumSource();
  if(viewer){viewer.wafer=false;$('#wafer-view').setAttribute('aria-pressed','false');viewer.setView('perspective');renderViews();}
}
$('#template').innerHTML=options(templateNames,project.template);
$('#load-template').onclick=()=>confirm('新建项目',`将以“${templateNames[$('#template').value]}”模板新建项目。当前项目会保留自动备份。`,async()=>{
  const next=createProject($('#template').value);
  try{const stored=JSON.parse(localStorage.getItem(LIBRARY)||'null');if(stored){const merged=new Map(next.materials.map(m=>[m.id,m]));stored.forEach(m=>merged.set(m.id,m));next.materials=[...merged.values()];validateProject(next);}}catch(error){toast('已使用内置材料：'+error.message);next.materials=createProject($('#template').value).materials;}
  try{await window.virtualFabFiles?.reset();activateProject(next);}catch(error){toast('新建项目失败：'+error.message);}
},hasUnsavedChanges());
$('#new-project').onclick=()=>$('#load-template').click();
$('#confirm-cancel').onclick=()=>{$('#confirm-dialog').close();confirmAction=null;};$('#confirm-ok').onclick=()=>{$('#confirm-dialog').close();const action=confirmAction;confirmAction=null;action?.();};
$('#confirm-save').onclick=async()=>{if(await saveProject()){$('#confirm-dialog').close();const action=confirmAction;confirmAction=null;action?.();}};
$('#project-name').onchange=e=>{const next=structuredClone(project);next.name=e.target.value.trim()||'未命名项目';applyChange(next);};
$('#open-project').onclick=()=>{
  if(!window.virtualFabFiles){$('#project-file').click();return;}
  const open=async()=>{try{const chosen=await window.virtualFabFiles.open();if(chosen)activateProject(chosen.project,chosen.path);}catch(error){toast('打开失败，当前项目未修改：'+error.message);}};
  if(hasUnsavedChanges())confirm('打开项目','当前项目有未保存的更改。',open,true);else open();
};
$('#project-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{if(file.size>2_000_000)throw Error('项目文件上限为 2 MB。');const imported=JSON.parse(await file.text());validateProject(imported);confirm('打开项目',`将打开“${imported.name}”，包含 ${imported.steps.length} 个步骤。当前项目会保留自动备份。`,async()=>{try{await window.virtualFabFiles?.reset();activateProject(imported,file.name);}catch(error){toast('打开失败：'+error.message);}},hasUnsavedChanges());}catch(error){toast('导入失败，当前项目未修改：'+error.message);}
};
$('#save-project').onclick=()=>saveProject();$('#save-as-project').onclick=()=>saveProject(true);
$('#grid-settings').onclick=()=>{
  $('#grid-form [name="sizeUm"]').value=project.sizeUm;$('#grid-form [name="resolution"]').value=project.resolution;
  $('#grid-results').innerHTML='';updateGridSpacing();$('#grid-dialog').showModal();
};
$('#close-grid').onclick=()=>$('#grid-dialog').close();
function updateGridSpacing(){
  const f=$('#grid-form');$('#grid-spacing').textContent=`Δx = ${(Number(f.elements.sizeUm.value)/Number(f.elements.resolution.value)).toFixed(3)} μm`;
  $('#grid-results').innerHTML='';
}
$('#grid-form').oninput=updateGridSpacing;
$('#grid-form').onsubmit=e=>{
  e.preventDefault();const next=structuredClone(project);next.sizeUm=Number(e.target.elements.sizeUm.value);next.resolution=Number(e.target.elements.resolution.value);
  const oldIndex=sliceIndex;sliceIndex=Math.floor(next.resolution/2);
  if(applyChange(next))$('#grid-dialog').close();else sliceIndex=oldIndex;
};
$('#compare-grids').onclick=()=>{
  try{
    if(!$('#grid-form').reportValidity())return;
    const next={...project,sizeUm:Number($('#grid-form [name="sizeUm"]').value),resolution:Number($('#grid-form [name="resolution"]').value)};
    validateProject(next);const grids=compareGrids(next,through),ids=[...new Set(grids.flatMap(g=>g.metrics.map(m=>m.stepId)))];
    $('#grid-results').innerHTML=`<div class="table-scroll"><table class="data-table"><caption>当前工艺位置 · 面积 (μm²)</caption><thead><tr><th>膜层</th>${grids.map(g=>`<th>${g.resolution} 列<br>Δx ${g.dxUm.toFixed(3)}</th>`).join('')}</tr></thead><tbody>${ids.map(id=>`<tr><td>${esc(project.steps.find(s=>s.id===id)?.name||id)}</td>${grids.map(g=>`<td>${(g.metrics.find(m=>m.stepId===id)?.areaUm2||0).toFixed(3)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="view-note">面积差为采样敏感度，不等同于真实误差。窗口改变会裁剪器件；工艺尺寸与偏移不随窗口缩放。</p>${grids.map(g=>`<p class="view-note">${g.resolution} 列：${g.stoppedAt!==null?'工艺停止；': ''}${g.warnings.length?g.warnings.map(w=>`步骤 ${w.index+1} ${esc(w.code)}`).join('，'):'无小于两列采样间距的特征'}</p>`).join('')}`;
  }catch(error){$('#grid-results').textContent=error.message;}
};
$('#process-search').oninput=renderLibrary;
$('#first-step').onclick=()=>selectStep(-1);$('#previous-step').onclick=()=>selectStep(through-1);$('#next-step').onclick=()=>selectStep(through+1);$('#run-all').onclick=()=>selectStep(project.steps.length-1);
$('#play').onclick=()=>{if(timer){stop();return;}if(through>=project.steps.length-1)selectStep(-1);$('#play').textContent='Ⅱ';$('#play').setAttribute('aria-label','暂停工艺');timer=setInterval(()=>{selectStep(through+1,{playing:true});if(through>=project.steps.length-1||state.stoppedAt!==null)stop();},850);};
function updateAnalysisLayout(){
  const view=$('[data-view][aria-selected="true"]').dataset.view,equilibrium=$('[data-band-mode][aria-selected="true"]').dataset.bandMode==='equilibrium';
  $('.slice-panel').hidden=view==='atomic'||view==='bands'&&equilibrium;
  $('#workspace-title').textContent=view==='atomic'?'原子计算':view==='structure'?'工艺编辑器':view==='electrical'?'电学模型':equilibrium?'PN/PIN 平衡':'材料与界面';
  $('#grid-settings').hidden=view==='atomic';$('#run-all').hidden=view==='atomic';
  $('#model-label').textContent=view==='atomic'?'原子晶胞 · Å':`局部区域 · ${project.sizeUm} × ${project.sizeUm} μm`;
  $('.inspector-tabs').hidden=view==='atomic';$('#atomic-inspector').hidden=view!=='atomic';
  $('.workbench').classList.toggle('atomic-mode',view==='atomic');
  $('#params-panel').hidden=view==='atomic'||$('[data-panel="params"]').getAttribute('aria-selected')!=='true';
  $('#results-panel').hidden=view==='atomic'||$('[data-panel="results"]').getAttribute('aria-selected')!=='true';
}
$$('[data-view]').forEach(b=>b.onclick=()=>{$$('[data-view]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));for(const view of ['structure','bands','electrical','atomic'])$(`#${view}-view`).hidden=view!==b.dataset.view;updateAnalysisLayout();if(b.dataset.view==='structure')requestAnimationFrame(()=>viewer?.resize());if(b.dataset.view==='atomic')requestAnimationFrame(()=>atomicUI?.show());});
$$('[data-band-mode]').forEach(b=>b.onclick=()=>{
  $$('[data-band-mode]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));
  $('#material-bands-panel').hidden=b.dataset.bandMode!=='materials';$('#equilibrium-panel').hidden=b.dataset.bandMode!=='equilibrium';
  updateAnalysisLayout();renderEquilibriumResult();
});
$$('[data-panel]').forEach(b=>b.onclick=()=>setPanel(b.dataset.panel));
$('#slice-range').oninput=e=>{sliceIndex=Number(e.target.value);renderViews();};
for(const type of ['perspective','top','front'])$(`#view-${type}`).onclick=()=>viewer?.setView(type);
$('#explode').onclick=()=>{if(!viewer)return;viewer.exploded=!viewer.exploded;$('#explode').setAttribute('aria-pressed',String(viewer.exploded));renderViews();};
$('#wafer-view').onclick=()=>{if(!viewer)return;viewer.wafer=!viewer.wafer;$('#wafer-view').setAttribute('aria-pressed',String(viewer.wafer));renderViews();viewer.setView('perspective');};
$('#open-materials').onclick=()=>{materialId=project.materials[0].id;renderMaterialList();renderMaterialDetail();$('#materials-dialog').showModal();};$('#close-materials').onclick=()=>$('#materials-dialog').close();$('#material-search').oninput=renderMaterialList;$('#new-material').onclick=()=>renderMaterialDetail(true);
function updateCurve(){try{if(!$('#curve-form').reportValidity())return false;const values=Object.fromEntries(new FormData($('#curve-form')).entries());for(const key in values)values[key]=Number(values[key]);curveRows=diodeCurve({...values,minV:-.5,maxV:.5});drawCurve($('#curve-plot'),curveRows);return true;}catch(error){curveRows=[];$('#curve-plot').textContent=error.message;toast(error.message);return false;}}
$('#curve-form').onsubmit=e=>{e.preventDefault();updateCurve();};$('#export-curve').onclick=()=>{if(updateCurve())download('manual-shockley-model.csv','voltage_V,current_A\n'+curveRows.map(r=>`${r.voltageV},${r.currentA}`).join('\n')+'\n','text/csv');};
function readEquilibriumConfig(){
  return validateEquilibrium({material:'Si',temperatureK:300,...Object.fromEntries([...new FormData($('#equilibrium-form'))].map(([k,v])=>[k,Number(v)]))});
}
$('#equilibrium-form').oninput=()=>{
  invalidateEquilibrium();$('#equilibrium-status').textContent='参数已更改，尚未重新求解。';
  try{project.equilibrium=readEquilibriumConfig();persist();}
  catch(error){$('#equilibrium-status').textContent=error.message;}
};
$('#equilibrium-form').onsubmit=async e=>{
  e.preventDefault();if(equilibriumRunning||!window.virtualFabPhysics)return;
  try{
    const config=readEquilibriumConfig();invalidateEquilibrium();
    const next=structuredClone(project);next.equilibrium=config;if(!applyChange(next))return;
    const generation=equilibriumGeneration;equilibriumRunning=true;$('#solve-equilibrium').disabled=true;$('#equilibrium-status').textContent='正在求解并检查物理网格…';
    try{const r=assessEquilibrium(await window.virtualFabPhysics.equilibrium(config),config);if(generation===equilibriumGeneration){manualResult=r;if($('#equilibrium-source').value==='manual')equilibriumResult=r;$('#equilibrium-settings').open=false;renderEquilibriumResult();}}
    catch(error){if(generation===equilibriumGeneration)$('#equilibrium-status').textContent='求解失败：'+error.message;}
    finally{equilibriumRunning=false;$('#solve-equilibrium').disabled=false;}
  }catch(error){$('#equilibrium-status').textContent=error.message;}
};
$('#equilibrium-quantity').onchange=renderEquilibriumResult;
function updateEquilibriumSource(){
  const device=$('#equilibrium-source').value==='device';$('#device-physics-panel').hidden=!device;$('#equilibrium-settings').hidden=device;$('#solve-equilibrium').hidden=device;
  equilibriumResult=device?deviceResult:manualResult;renderEquilibriumResult();if(device)deviceUI?.preview();
}
$('#equilibrium-source').onchange=updateEquilibriumSource;
$('#export-equilibrium-meta').onclick=()=>{if(equilibriumResult)download('si-equilibrium-result.json',JSON.stringify(equilibriumResult,null,2)+'\n');};
$('#export-equilibrium').onclick=()=>{
  if(!equilibriumResult)return;
  const r=equilibriumResult,fields=$('#equilibrium-quantity').value==='field';
  let rows=fields?r.fields:r.rows,columns=fields?['xUm','fieldVcm']:['xUm','potentialV','ecEv','evEv','efEv','electronCm3','holeCm3','netDopingCm3'];
  if(r.mapping){
    const m=r.mapping;rows=rows.map(row=>({...row,sUm:row.xUm,axisCoordinateUm:m.path.startUm+m.direction*row.xUm,fieldAlongPathVcm:row.fieldVcm,fieldAlongAxisVcm:m.direction*row.fieldVcm}));
    columns=fields?['sUm','axisCoordinateUm','fieldAlongPathVcm','fieldAlongAxisVcm']:['sUm','axisCoordinateUm',...columns.slice(1)];
  }
  const metadata={schemaVersion:1,columns,coordinate:r.mapping?`s 沿 ${r.mapping.axis.toUpperCase()} 路径；轴向场 = 路径方向 × 沿路径场`:'独立算例 x',units:{xUm:'μm',sUm:'μm',axisCoordinateUm:'μm',potentialV:'V',ecEv:'eV',evEv:'eV',efEv:'eV',electronCm3:'cm⁻³',holeCm3:'cm⁻³',netDopingCm3:'cm⁻³',fieldVcm:'V/cm',fieldAlongPathVcm:'V/cm',fieldAlongAxisVcm:'V/cm'},energyReference:'EF = 0，内部参考，非真空绝对能量',model:r.model,solverVersion:r.solverVersion,mathLibraries:r.mathLibraries,config:r.config,parameters:r.parameters,mapping:r.mapping||null,task:r.task||null,history:!!r.history,accuracyPassed:r.accuracyPassed,validation:r.validation,depletion:r.depletion,warnings:r.warnings};
  download(fields?'si-equilibrium-field.csv':'si-equilibrium-nodes.csv',[columns.join(','),...rows.map(row=>columns.map(k=>row[k]).join(','))].join('\n')+'\n','text/csv',metadata);
};
try{viewer=new StructureViewer($('#three-view'));}catch(error){$('#three-view').innerHTML='<p class="empty-message">WebGL 不可用。剖面、工艺计算与诊断仍可使用。</p>';toast('三维视窗初始化失败：'+error.message);}
new ResizeObserver(revealCurrentStep).observe($('#recipe-cards'));
renderLibrary();render();renderEquilibriumConfig();updateCurve();if(restoreError)toast(restoreError);
atomicUI=new AtomicUI({getProject:()=>project,setConfig:config=>{project.dft=config;persist();},toast});
deviceUI=new DevicePhysicsUI({getProject:()=>project,getThrough:()=>through,setConfig:config=>{const next={...project,devicePhysics:config};validateProject(next);project=next;persist();},showResult:r=>{deviceResult=r;if($('#equilibrium-source').value==='device'){equilibriumResult=r;renderEquilibriumResult();}},newBenchmark:pin=>confirm('新建硅物理基准','将新建体硅几何与明确给定的理想掺杂区域。浓度为示例输入，不代表工艺预测或实测。',async()=>{await window.virtualFabFiles?.reset();activateProject(siliconBenchmark(pin));},hasUnsavedChanges()),toast});
$('#equilibrium-source').value=project.devicePhysics?'device':'manual';updateEquilibriumSource();
new ResizeObserver(()=>drawSlice($('#slice-plot'),state,project.materials,sliceIndex)).observe($('#slice-plot'));
new ResizeObserver(()=>{if(curveRows.length)drawCurve($('#curve-plot'),curveRows);}).observe($('#curve-plot'));
new ResizeObserver(()=>{if(equilibriumResult)drawEquilibrium($('#equilibrium-plot'),equilibriumResult,$('#equilibrium-quantity').value);}).observe($('#equilibrium-plot'));
const bench=$('.workbench'),desktopLayout=matchMedia('(min-width: 851px)'),gutters=[$('#library-resize'),$('#inspector-resize')];
const columnWidths=()=>getComputedStyle(bench).gridTemplateColumns.split(' ').map(Number.parseFloat);
const updateSeparators=()=>{const widths=columnWidths();for(const [i,gutter] of gutters.entries()){const track=i?4:0;gutter.setAttribute('aria-valuemin',i?'250':'170');gutter.setAttribute('aria-valuemax',Math.round(widths[track]+widths[2]-420));gutter.setAttribute('aria-valuenow',Math.round(widths[track]));}};
let splitLayout;
function setDesktopLayout(){
  if(desktopLayout.matches){
    if(!splitLayout)splitLayout=SplitGrid({columnGutters:[{track:1,element:gutters[0]},{track:3,element:gutters[1]}],columnMinSizes:{0:170,2:420,4:250},onDragEnd:()=>{const widths=columnWidths();bench.style.gridTemplateColumns=`${widths[0]}px 5px 1fr 5px ${widths[4]}px`;updateSeparators();}});
    updateSeparators();
  }else{splitLayout?.destroy();splitLayout=null;bench.style.removeProperty('grid-template-columns');}
}
for(const [i,gutter] of gutters.entries())gutter.onkeydown=e=>{
  if(!desktopLayout.matches||!['ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();const widths=columnWidths(),track=i?2:0,other=track+2,min=[170,0,420,0,250],sum=widths[track]+widths[other];
  widths[track]=Math.max(min[track],Math.min(sum-min[other],widths[track]+(e.key==='ArrowRight'?16:-16)));
  widths[other]=sum-widths[track];bench.style.gridTemplateColumns=`${widths[0]}px 5px 1fr 5px ${widths[4]}px`;updateSeparators();
};
desktopLayout.addEventListener('change',setDesktopLayout);setDesktopLayout();
new ResizeObserver(()=>{if(!desktopLayout.matches)return;if(columnWidths()[2]<420)bench.style.removeProperty('grid-template-columns');updateSeparators();}).observe(bench);
