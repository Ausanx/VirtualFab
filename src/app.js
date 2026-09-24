import { createProject,processTypes,templateNames,patterns,roles,step } from './recipes.js';
import { categoryNames,evidenceNames,getMaterial } from './materials.js';
import { simulate,validateProject } from './engine.js';
import { analyze,diodeCurve } from './physics.js';
import { StructureViewer,drawSlice,drawBands,drawCurve,escapeHtml as esc } from './viewer.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const STORAGE='virtualfab.project.v1',LIBRARY='virtualfab.materials.v1';
let project=createProject('crossbar'),restoreError='';
try{const saved=localStorage.getItem(STORAGE);if(saved){const parsed=JSON.parse(saved);validateProject(parsed);project=parsed;}}catch(error){restoreError=`本地项目读取失败，已加载示例；原存档尚未覆盖。${error.message}`;}
let selected=project.steps.length-1,through=selected,sliceIndex=Math.floor(project.resolution/2),state,result,viewer,timer=null,materialId=project.materials[0].id,curveRows=[],confirmAction=null;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(project));$('#save-status').textContent='已保存到本机';}catch{$('#save-status').textContent='保存失败 · 请导出';toast('本地存储不可用或空间不足，请导出项目保存。');}}
function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function confirm(title,text,action){$('#confirm-title').textContent=title;$('#confirm-text').textContent=text;confirmAction=action;$('#confirm-dialog').showModal();}
function stop(){if(timer){clearInterval(timer);timer=null;}$('#play').textContent='▶';$('#play').setAttribute('aria-label','播放工艺');}
function applyChange(next){try{validateProject(next);project=next;persist();render();return true;}catch(error){toast(error.message);return false;}}
const descriptions={substrate:'选择真实晶圆尺寸。微米级局部窗口单独计算，硅片底部在视图中截断。',dice:'矩形芯片尺寸将检查是否能放入所选圆形晶圆。',clean:'记录清洁条件与顺序；材料兼容性需匹配工艺数据。',coat:'光刻胶牌号决定正负性。当前膜厚由输入给定，转速不自动推导膜厚。',bake:'记录光刻胶烘烤。首版不计算光化学反应或交联程度。',expose:'图案定义“显影后的目标开口”。负胶会自动反转曝光区；此步骤只记录曝光，下一步显影才移除胶。',develop:'根据当前胶的正负性与曝光结果生成实际开口。',deposit:'按顶表面沉积膜厚。用于估计层叠与开口填充；侧壁通量和成核尚未求解。',transfer:'以矩形区域放置薄膜，保留厚度和载流子类型；不模拟转移应力与残留。',etch:'按速率 × 时间消耗指定外露材料。其他材料速率未知时保留并提示。',liftoff:'移除已显影光刻胶及其上方的沉积物，保留开口内沉积层。',strip:'去除当前胶层；上方有沉积物时应使用 lift-off。',anneal:'记录温度、时间与气氛；未有标定模型时不自动改变能带或载流子。'};
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
function renderParams(){
  const s=project.steps[selected];if(!s){$('#params-panel').innerHTML='<p class="empty-message">从左侧添加工艺卡片，或选择已有步骤。</p>';return;}
  $('#params-panel').innerHTML=`<div class="step-tag"><span>${String(selected+1).padStart(2,'0')}</span><span>/</span><span>${processTypes[s.type].short}</span><span class="badge">${s.enabled?'已启用':'已禁用'}</span></div><h2 class="inspector-title">${esc(processTypes[s.type].label)}</h2><p class="step-description">${esc(descriptions[s.type])}</p><form id="param-form" class="param-form"><label>步骤名称<input name="stepName" value="${esc(s.name)}" maxlength="120" required></label>${Object.entries(s.params).filter(([k])=>k in processTypes[s.type].defaults).map(([k,v])=>fieldHtml(k,v,s)).join('')}<label class="check-label"><input name="stepEnabled" type="checkbox"${s.enabled?' checked':''}>启用此步骤</label><button type="submit" class="primary">应用参数并重算</button></form><hr class="section-line"><div class="card-actions"><button data-action="up"${selected===0?' disabled':''}>↑ 前移</button><button data-action="down"${selected===project.steps.length-1?' disabled':''}>↓ 后移</button><button data-action="duplicate">复制步骤</button><button data-action="delete" class="remove"${project.steps.length<=1?' disabled':''}>删除步骤</button></div><p class="param-footnote">横向采样间距 ${(project.sizeUm/project.resolution).toFixed(2)} μm；Z 方向保留膜厚数值。改变上游卡片会重新计算下游结构。</p>`;
  $('#param-form').addEventListener('submit',e=>{
    e.preventDefault();stop();const next=structuredClone(project),target=next.steps[selected],data=new FormData(e.target);
    target.name=String(data.get('stepName')).trim();target.enabled=data.has('stepEnabled');
    for(const [key,value]of Object.entries(processTypes[target.type].defaults))target.params[key]=typeof value==='number'?Number(data.get(key)):typeof value==='boolean'?data.has(key):String(data.get(key));
    if(applyChange(next))toast('参数已应用，结构已重新计算。');
  });
  $$('#params-panel [data-action]').forEach(b=>b.onclick=()=>cardAction(b.dataset.action));
}
function cardAction(action){stop();const next=structuredClone(project);
  if(action==='delete'){next.steps.splice(selected,1);selected=Math.max(0,selected-1);}
  if(action==='duplicate'){const copy=structuredClone(next.steps[selected]);copy.id=crypto.randomUUID();copy.name+=' · 副本';next.steps.splice(selected+1,0,copy);selected++;}
  if(action==='up'||action==='down'){const to=selected+(action==='up'?-1:1);[next.steps[selected],next.steps[to]]=[next.steps[to],next.steps[selected]];selected=to;}
  through=selected;applyChange(next);
}
function stepSummary(s){const p=s.params;if(p.thicknessNm)return `${p.material} · ${p.thicknessNm} nm`;if(s.type==='substrate')return `${p.waferInch}″ ${p.material}${p.oxideNm?' / SiO₂':''}`;if(s.type==='expose')return patterns[p.pattern];if(s.type==='etch')return `${p.material} · ${p.durationS} s`;if(p.temperatureC)return `${p.temperatureC} °C · ${p.durationS} s`;return p.durationS?`${p.durationS} s`:s.type==='dice'?`${p.widthMm} × ${p.lengthMm} mm`:'';}
function renderCards(){
  const oldScroll=$('#recipe-cards').scrollLeft;
  $('#recipe-cards').innerHTML=project.steps.map((s,i)=>`<button class="recipe-card${i===selected?' current':''}${s.enabled?'':' disabled'}" draggable="true" data-index="${i}" aria-label="步骤 ${i+1} ${esc(s.name)}" aria-current="${i===selected?'step':'false'}"><div class="recipe-top"><span>${String(i+1).padStart(2,'0')} · ${processTypes[s.type].short}</span><span>${state.stoppedAt===i?'!':i<=state.completed&&s.enabled?'✓':'○'}</span></div><strong>${esc(s.name)}</strong><small>${esc(stepSummary(s))}</small></button>`).join('');
  $('#recipe-cards').scrollLeft=oldScroll;
  $$('.recipe-card').forEach(b=>{
    b.onclick=()=>selectStep(Number(b.dataset.index));
    b.ondragstart=e=>{e.dataTransfer.setData('text/plain',b.dataset.index);e.dataTransfer.effectAllowed='move';};
    b.ondragover=e=>{e.preventDefault();b.classList.add('drag-over');};b.ondragleave=()=>b.classList.remove('drag-over');
    b.ondrop=e=>{e.preventDefault();stop();const from=Number(e.dataTransfer.getData('text/plain')),to=Number(b.dataset.index);if(!Number.isInteger(from)||from<0||from>=project.steps.length)return;const next=structuredClone(project),[moved]=next.steps.splice(from,1);next.steps.splice(to,0,moved);selected=to;through=to;applyChange(next);};
  });
  $('#step-counter').textContent=`${through<0?'起点':`第 ${through+1} 步`} / ${project.steps.length} 步`;
  $('#previous-step').disabled=through<0;$('#first-step').disabled=through<0;$('#next-step').disabled=through>=project.steps.length-1;
}
function selectStep(i,{playing=false}={}){if(!playing)stop();through=Math.max(-1,Math.min(i,project.steps.length-1));selected=Math.max(0,through);render();$(`.recipe-card[data-index="${selected}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});}
function renderResults(){
  const issues=state.diagnostics.filter(d=>d.severity!=='info');$('#diagnostic-count').textContent=issues.length?issues.length:'';
  $('#results-panel').innerHTML=`<h3>结构与功能依据</h3><p class="result-summary">${result.structures.length} 类结构候选 · ${issues.length} 项需检查<br>结构成立不等同于功能已验证。</p>${result.structures.length?result.structures.map(s=>`<article class="structure-result"><span class="badge">${esc(s.code)}</span><h3>${esc(s.title)}</h3><p class="materials">${s.materials.map(esc).join(' / ')}</p>${s.evidence.map(t=>`<p>${esc(t)}</p>`).join('')}<details><summary>查看 ${s.missing.length} 项待核实条件</summary><ul>${s.missing.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></details></article>`).join(''):'<p class="empty-message">当前步骤尚未形成可识别的功能结构。继续执行工艺后自动更新。</p>'}<hr class="section-line"><h3>工艺检查</h3>${state.diagnostics.length?state.diagnostics.map(d=>`<div class="diagnostic ${d.severity}"><button data-diag-step="${d.index}">步骤 ${d.index+1} · ${d.severity==='error'?'停止':d.severity==='info'?'模型说明':'需核实'} ↗</button><p>${esc(d.message)}</p></div>`).join(''):'<p class="empty-message">当前未发现流程错误。材料兼容性仍取决于参数完整程度。</p>'}`;
  $$('[data-diag-step]').forEach(b=>b.onclick=()=>{selectStep(Number(b.dataset.diagStep));setPanel('params');});
}
function setPanel(panel){$$('[data-panel]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.panel===panel)));$('#params-panel').hidden=panel!=='params';$('#results-panel').hidden=panel!=='results';}
function renderViews(){
  let scale={gain:1};try{if(viewer)scale=viewer.update(state,project.materials,sliceIndex);}catch(error){toast('三维视图未能更新：'+error.message);}
  $('#scale-label').textContent=viewer?.wafer?`${state.substrate?.waferInch||'—'} inch 晶圆 · 中心框为划片示意`:`Z 显示 ×${scale.gain.toFixed(1)} · 衬底底部截断`;
  const ids=[...new Set(state.cells.flat().map(l=>l.material))];
  $('#layer-legend').innerHTML=ids.map(id=>{const m=getMaterial(project.materials,id);return `<span class="legend-item"><i class="swatch" style="background:${m.color}"></i>${esc(m.name)}</span>`;}).join('')||'<span>尚未执行衬底步骤</span>';
  drawSlice($('#slice-plot'),state,project.materials,sliceIndex);
  drawBands($('#band-diagram'),state,project.materials);
  $('#interface-results').innerHTML=result.interfaces.map(i=>`<div class="interface-row"><span>${esc(i.a)} / ${esc(i.b)}</span><span>${i.type==='unknown'?'带阶数据不足':`Type-${i.type} · ΔE꜀ ${i.deltaEc.toFixed(2)} eV · ΔEᵥ ${i.deltaEv.toFixed(2)} eV`}</span></div>`).join('');
  const y=(sliceIndex+.5)*project.sizeUm/project.resolution-project.sizeUm/2;$('#slice-value').textContent=y.toFixed(1);$('#slice-range').max=project.resolution-1;$('#slice-range').value=sliceIndex;
}
function render(){
  const start=performance.now();state=simulate(project,through);result=analyze(state,project.materials);const elapsed=performance.now()-start;
  $('#project-name').value=project.name;$('#workspace-title').textContent=project.name;$('#material-count').textContent=`${project.materials.length} 种材料 · 可编辑来源`;
  $('#model-label').textContent=`局部区域 · ${project.sizeUm} × ${project.sizeUm} μm`;$('#elapsed').textContent=`计算 ${elapsed.toFixed(0)} ms`;
  $('#simulation-status').textContent=state.stoppedAt!==null?`步骤 ${state.stoppedAt+1} 停止 · 查看诊断`:'几何计算完成 · 物理适用性见诊断';
  renderCards();renderParams();renderResults();renderViews();
}
function renderLibrary(){
  const search=$('#process-search').value.toLowerCase(),groups={};
  for(const [type,data]of Object.entries(processTypes)){if(!`${data.label} ${data.short}`.toLowerCase().includes(search))continue;(groups[data.group]??=[]).push({type,...data});}
  $('#process-library').innerHTML=Object.entries(groups).map(([name,items])=>`<div class="process-group"><h3>${esc(name)}</h3>${items.map(i=>`<button class="process-item" data-add="${i.type}" aria-label="添加${esc(i.label)}"><span class="process-glyph">${i.short}</span><span>${esc(i.label)}</span><span>＋</span></button>`).join('')}</div>`).join('')||'<p class="empty-message">没有匹配的工艺</p>';
  $$('[data-add]').forEach(b=>b.onclick=()=>{stop();const next=structuredClone(project);next.steps.splice(selected+1,0,step(b.dataset.add));selected++;through=selected;if(applyChange(next)){setPanel('params');$(`.recipe-card[data-index="${selected}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});}});
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
  $('#material-form').onsubmit=e=>{
    e.preventDefault();const data=new FormData(e.target),next=structuredClone(project),updated=structuredClone(m);
    for(const key of ['id','name','category','polarity','color','tone','reference','note'])updated[key]=String(data.get(key)||'').trim();
    for(const key of Object.keys(propertyLabels)){
      const evidence=String(data.get(key+'-evidence')),raw=data.get(key);
      if(evidence!=='missing'&&(raw===null||String(raw).trim()==='')){$('#material-error').textContent='有证据等级的参数需要数值；未知时请选择“缺失”。';return;}
      updated[key]={value:evidence==='missing'?null:Number(raw),unit:'eV',evidence,source:String(data.get(key+'-source')),note:String(data.get(key+'-note'))};
    }
    if(isNew&&next.materials.some(a=>a.id===updated.id)){$('#material-error').textContent='材料 ID 已存在，请使用其他 ID。';return;}
    if(isNew)next.materials.push(updated);else next.materials[next.materials.findIndex(a=>a.id===m.id)]=updated;
    try{validateProject(next);}catch(error){$('#material-error').textContent=error.message;return;}
    project=next;materialId=updated.id;persist();try{localStorage.setItem(LIBRARY,JSON.stringify(project.materials));}catch{toast('项目已更新；材料库存储失败，请导出项目。');}
    render();renderMaterialList();renderMaterialDetail();toast('材料参数已保存；当前工艺已重算。');
  };
}

$('#template').innerHTML=options(templateNames,project.template);
$('#load-template').onclick=()=>confirm('新建模板项目','当前项目会保留一份本地备份。建议先导出需要长期保存的项目。',()=>{
  stop();try{localStorage.setItem(STORAGE+'.previous',JSON.stringify(project));}catch{}
  const next=createProject($('#template').value);
  try{const stored=JSON.parse(localStorage.getItem(LIBRARY)||'null');if(stored){const merged=new Map(next.materials.map(m=>[m.id,m]));stored.forEach(m=>merged.set(m.id,m));next.materials=[...merged.values()];validateProject(next);}}catch(error){toast('已使用内置材料：'+error.message);next.materials=createProject($('#template').value).materials;}
  project=next;selected=project.steps.length-1;through=selected;sliceIndex=Math.floor(project.resolution/2);persist();render();if(viewer){viewer.wafer=false;$('#wafer-view').setAttribute('aria-pressed','false');viewer.setView('perspective');renderViews();}
});
$('#confirm-cancel').onclick=()=>{$('#confirm-dialog').close();confirmAction=null;};$('#confirm-ok').onclick=()=>{$('#confirm-dialog').close();const action=confirmAction;confirmAction=null;action?.();};
$('#project-name').onchange=e=>{const next=structuredClone(project);next.name=e.target.value.trim()||'未命名项目';applyChange(next);};
$('#open-project').onclick=()=>$('#project-file').click();
$('#project-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{if(file.size>2_000_000)throw Error('项目文件上限为 2 MB。');const imported=JSON.parse(await file.text());validateProject(imported);confirm('打开项目',`将打开“${imported.name}”，包含 ${imported.steps.length} 个步骤。当前项目会保留本地备份。`,()=>{stop();try{localStorage.setItem(STORAGE+'.previous',JSON.stringify(project));}catch{}project=imported;selected=project.steps.length-1;through=selected;sliceIndex=Math.floor(project.resolution/2);$('#template').value=project.template||'blank';persist();render();});}catch(error){toast('导入失败，当前项目未修改：'+error.message);}
};
$('#export-project').onclick=()=>download((project.name.replace(/[<>:"/\\|?*]/g,'_')||'VirtualFab')+'.json',JSON.stringify(project,null,2));
$('#process-search').oninput=renderLibrary;
$('#first-step').onclick=()=>selectStep(-1);$('#previous-step').onclick=()=>selectStep(through-1);$('#next-step').onclick=()=>selectStep(through+1);$('#run-all').onclick=()=>selectStep(project.steps.length-1);
$('#play').onclick=()=>{if(timer){stop();return;}if(through>=project.steps.length-1)selectStep(-1);$('#play').textContent='Ⅱ';$('#play').setAttribute('aria-label','暂停工艺');timer=setInterval(()=>{selectStep(through+1,{playing:true});if(through>=project.steps.length-1||state.stoppedAt!==null)stop();},850);};
$$('[data-view]').forEach(b=>b.onclick=()=>{$$('[data-view]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));for(const view of ['structure','bands','electrical'])$(`#${view}-view`).hidden=view!==b.dataset.view;if(b.dataset.view==='structure')requestAnimationFrame(()=>viewer?.resize());});
$$('[data-panel]').forEach(b=>b.onclick=()=>setPanel(b.dataset.panel));
$('#slice-range').oninput=e=>{sliceIndex=Number(e.target.value);renderViews();};
for(const type of ['perspective','top','front'])$(`#view-${type}`).onclick=()=>viewer?.setView(type);
$('#explode').onclick=()=>{if(!viewer)return;viewer.exploded=!viewer.exploded;$('#explode').setAttribute('aria-pressed',String(viewer.exploded));renderViews();};
$('#wafer-view').onclick=()=>{if(!viewer)return;viewer.wafer=!viewer.wafer;$('#wafer-view').setAttribute('aria-pressed',String(viewer.wafer));renderViews();viewer.setView('perspective');};
$('#open-materials').onclick=()=>{materialId=project.materials[0].id;renderMaterialList();renderMaterialDetail();$('#materials-dialog').showModal();};$('#close-materials').onclick=()=>$('#materials-dialog').close();$('#material-search').oninput=renderMaterialList;$('#new-material').onclick=()=>renderMaterialDetail(true);
function updateCurve(){try{if(!$('#curve-form').reportValidity())return false;const values=Object.fromEntries(new FormData($('#curve-form')).entries());for(const key in values)values[key]=Number(values[key]);curveRows=diodeCurve({...values,minV:-.5,maxV:.5});drawCurve($('#curve-plot'),curveRows);return true;}catch(error){curveRows=[];$('#curve-plot').textContent=error.message;toast(error.message);return false;}}
$('#curve-form').onsubmit=e=>{e.preventDefault();updateCurve();};$('#export-curve').onclick=()=>{if(updateCurve())download('manual-shockley-model.csv','voltage_V,current_A\n'+curveRows.map(r=>`${r.voltageV},${r.currentA}`).join('\n')+'\n','text/csv');};
try{viewer=new StructureViewer($('#three-view'));}catch(error){$('#three-view').innerHTML='<p class="empty-message">WebGL 不可用。剖面、工艺计算与诊断仍可使用。</p>';toast('三维视窗初始化失败：'+error.message);}
renderLibrary();render();updateCurve();if(restoreError)toast(restoreError);
