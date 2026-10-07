import { physicsGeometry,emptyDevicePhysics,physicalRegion,mapDevice,deviceInputKey,geometrySnapshot } from './device-model.js';
import { escapeHtml as esc } from './viewer.js';

const $=s=>document.querySelector(s),axes=['x','y','z'];
const states={running:'运行中',completed:'已完成',failed:'失败',canceled:'已取消',interrupted:'已中断',missing:'本机任务数据缺失',corrupted:'数据校验失败'};
const evidence={missing:'未知',estimated:'估算 / 模型输入',derived:'推导',measured:'实测'};
const option=(key,label,value)=>`<option value="${esc(key)}"${key===value?' selected':''}>${esc(label)}</option>`;
const input=(name,label,value,type='number')=>`<label>${label}<input name="${name}" type="${type}"${type==='number'?' step="any"':''} value="${esc(value??'')}"></label>`;
export class DevicePhysicsUI{
  constructor({getProject,getThrough,setConfig,showResult,newBenchmark,toast}){
    Object.assign(this,{getProject,getThrough,setConfig,showResult,newBenchmark,toast});this.api=window.virtualFabPhysics;this.selected='';this.generation=0;
    this.dirtyRegions=new Set();
    $('#device-bind').onclick=()=>{try{if(this.getThrough()<0)throw Error('请先执行到有效工艺状态。');const p=emptyDevicePhysics(this.getProject(),this.getThrough());p.jobs=[...(this.config()?.jobs||[])];this.commit(p);this.pathDirty=false;this.regionDirty=false;this.dirtyRegions.clear();this.renderConfig();}catch(e){this.error(e);}};
    for(const type of ['pn','pin'])$('#device-new-'+type).onclick=()=>newBenchmark(type==='pin');
    $('#device-add-region').onclick=()=>{
      if(this.regionDirty){this.error(Error('请先保存已有区域编辑。'));return;}
      if(!this.bound)return;const p=structuredClone(this.config()),node=this.geometry.graph.nodes[Number($('#device-region-choice').value)];if(!node)return;
      p.regions.push(physicalRegion(node));this.commit(p);this.renderRegions();this.preview();
    };
    $('#device-path-form').onsubmit=e=>{
      e.preventDefault();try{
        const p=structuredClone(this.config()),data=new FormData(e.target);if(!p)throw Error('请先选择当前工艺。');
        for(const k of ['x','y','z','startUm','endUm','meshNm']){if(data.get(k)==='')throw Error('路径坐标或网格不能为空。');p.path[k]=Number(data.get(k));}p.path.axis=data.get('axis');
        for(const k of ['start','end']){const v=data.get(k);p.path[k]=v==='truncation'?{kind:'truncation'}:{kind:'electrode',binding:structuredClone(this.geometry.graph.nodes[Number(v)].binding)};}
        this.commit(p);this.pathDirty=false;this.preview();
      }catch(error){this.error(error);}
    };
    $('#device-path-form').oninput=()=>{this.pathDirty=true;$('#device-solve').disabled=true;$('#device-preview').textContent='路径编辑尚未应用；请应用路径并预览。';this.renderResultBinding();};
    $('#device-solve').onclick=()=>this.solve();$('#device-cancel').onclick=async()=>{try{await this.api.cancel(this.selected);await this.refresh();}catch(e){this.error(e);}};
    $('#device-jobs').onchange=()=>{this.selected=$('#device-jobs').value;this.resultKey='';this.showResult(null);void this.refresh();};
    this.updateProject();this.poll=setInterval(()=>{if(!$('#device-physics-panel').hidden)void this.refresh();},1000);
  }
  config(){return this.getProject().devicePhysics;}
  regionLabel(n){return `${this.getProject().steps.find(s=>s.id===n.stepId)?.name||n.material} · ${n.material} · (${n.binding.anchor.map(v=>Number(v.toPrecision(4))).join(', ')}) μm`;}
  error(e){$('#device-status').textContent=e.message;this.toast(e.message);}
  commit(p){this.setConfig(p);this.renderResultBinding();}
  updateProject(){this.generation++;this.selected=(this.config()?.jobs||[]).at(-1)||'';this.resultKey='';this.bindingResultKey='';this.info=null;this.pathDirty=false;this.regionDirty=false;this.dirtyRegions.clear();$('#device-model-settings').open=true;this.renderConfig();void this.refresh();}
  updateGeometry(){
    const p=this.config();this.bound=!!p&&p.through===this.getThrough()&&p.geometry===geometrySnapshot(this.getProject(),this.getThrough());
    $('#device-binding').textContent=!p?'尚未选择工艺状态。':this.bound?`绑定步骤 ${p.through+1} · ${p.regions.length} 个物理区域 · 给定掺杂`:'空间绑定失效：工艺状态、材料或采样网格已改变。请重新选择当前工艺与区域。';
    $('#device-add-region').disabled=!this.bound;
    if(!this.bound){$('#device-solve').disabled=true;$('#device-preview').textContent='当前结构未绑定，不能提交定量求解。';}
    this.renderResultBinding();
  }
  renderConfig(){
    this.geometry=physicsGeometry(this.getProject(),this.getThrough());const p=this.config();this.updateGeometry();
    $('#device-region-choice').innerHTML=this.geometry.graph.nodes.map((n,i)=>n.material==='Si'?option(String(i),this.regionLabel(n),''):'').join('');
    const boundaries=option('truncation','人为截断 · 理想中性边界','')+this.geometry.graph.nodes.map((n,i)=>['conductor','tco'].includes(this.getProject().materials.find(m=>m.id===n.material)?.category)?option(String(i),this.regionLabel(n),''):'').join('');
    for(const k of ['start','end']){
      const select=$(`#device-path-form [name="${k}"]`);select.innerHTML=boundaries;
      const b=p?.path[k];select.value=b?.kind==='electrode'?String(this.geometry.graph.nodes.findIndex(n=>JSON.stringify(n.binding)===JSON.stringify(b.binding))):'truncation';
    }
    for(const el of $('#device-path-form').elements)if(el.name&&!['start','end'].includes(el.name))el.value=p?.path[el.name]??'';
    this.renderRegions();this.preview();
  }
  renderRegions(){
    const p=this.config();$('#device-regions').innerHTML=(p?.regions||[]).map(r=>`<details class="device-region"><summary>${esc(r.name)} · Nᴀ ${r.acceptor.value??'未知'} / Nᴅ ${r.donor.value??'未知'} cm⁻³</summary><form data-region="${esc(r.id)}" class="physics-form">
      ${input('name','区域名称',r.name,'text')}${input('binding','产生步骤 / 空间锚点',this.regionLabel({stepId:r.binding.stepId,material:r.binding.material,binding:r.binding}),'text').replace('<input','<input disabled')}
      ${axes.flatMap(k=>[input(k+'0',k.toUpperCase()+' 下界 (μm)',r.box[k+'0']),input(k+'1',k.toUpperCase()+' 上界 (μm)',r.box[k+'1'])]).join('')}
      ${['acceptor','donor'].map(key=>`${input(key,key==='donor'?'施主 Nᴅ (cm⁻³) · 空白为未知':'受主 Nᴀ (cm⁻³) · 空白为未知',r[key].value)}<label>证据<select name="${key}-evidence">${Object.entries(evidence).map(([k,v])=>option(k,v,r[key].evidence)).join('')}</select></label>${input(key+'-source','来源 / 文献定位',r[key].source,'text')}${input(key+'-note','适用条件',r[key].note,'text')}`).join('')}
      <label>浓度含义<select name="basis">${Object.entries({ionized:'已电离杂质浓度',activated:'已激活杂质浓度',nominal:'名义杂质浓度',carrier:'实测自由载流子（不能直接作为掺杂）'}).map(([k,v])=>option(k,v,r.basis)).join('')}</select></label>${input('activation','激活比例 · 空白为未知',r.activation)}
      <label>电离模型<select name="ionization">${Object.entries({unknown:'未知',full:'完全电离（显式假设）',partial:'部分电离（尚未支持）'}).map(([k,v])=>option(k,v,r.ionization)).join('')}</select></label>${input('assumption','模型假设与条件',r.assumption,'text')}
      <div class="physics-actions"><button type="submit">保存区域</button><button type="button" data-delete-region="${esc(r.id)}">删除区域</button></div></form></details>`).join('')||'<p class="view-note">尚未定义物理掺杂区域。</p>';
    for(const form of document.querySelectorAll('[data-region]')){
      form.oninput=()=>{this.dirtyRegions.add(form.dataset.region);this.regionDirty=true;$('#device-solve').disabled=true;$('#device-preview').textContent='区域编辑尚未保存；请保存区域后预览。';this.renderResultBinding();};
      form.onsubmit=e=>{e.preventDefault();try{
        const next=structuredClone(this.config()),r=next.regions.find(r=>r.id===form.dataset.region),data=new FormData(form);
        r.name=String(data.get('name'));for(const k of axes)for(const suffix of ['0','1']){const v=data.get(k+suffix);if(v==='')throw Error('空间坐标不能为空。');r.box[k+suffix]=Number(v);}
        for(const key of ['donor','acceptor']){const v=data.get(key);r[key]={value:v===''?null:Number(v),unit:'cm^-3',evidence:v===''?'missing':data.get(key+'-evidence')==='missing'?'estimated':data.get(key+'-evidence'),source:String(data.get(key+'-source')),note:String(data.get(key+'-note'))};}
        r.basis=data.get('basis');r.ionization=data.get('ionization');r.activation=data.get('activation')===''?null:Number(data.get('activation'));r.assumption=String(data.get('assumption'));
        this.commit(next);this.dirtyRegions.delete(r.id);this.regionDirty=this.dirtyRegions.size>0;form.closest('details').querySelector('summary').textContent=`${r.name} · Nᴀ ${r.acceptor.value??'未知'} / Nᴅ ${r.donor.value??'未知'} cm⁻³`;this.preview();
      }catch(error){this.error(error);}};
    }
    for(const b of document.querySelectorAll('[data-delete-region]'))b.onclick=()=>{if(this.regionDirty){this.error(Error('请先保存区域编辑。'));return;}const next=structuredClone(this.config());next.regions=next.regions.filter(r=>r.id!==b.dataset.deleteRegion);this.commit(next);this.renderRegions();this.preview();};
  }
  preview(){
    this.updateGeometry();$('#device-solve').disabled=true;if(!this.bound||this.pathDirty||this.regionDirty)return;
    try{
      const m=mapDevice(this.getProject(),this.getThrough());this.mapping=m;
      $('#device-preview').innerHTML=`<div class="table-scroll"><table class="data-table"><caption>${m.axis.toUpperCase()} 路径 · ${m.path.startUm} → ${m.path.endUm} μm · 横截面积 ${m.crossSectionUm2.toFixed(3)} μm²</caption><thead><tr><th>给定区域</th><th>路径坐标 (μm)</th><th>长度 (μm)</th><th>求解坐标 s (μm)</th></tr></thead><tbody>${m.regions.map((r,i)=>{const s=m.regions.slice(0,i).reduce((a,r)=>a+r.lengthUm,0);return `<tr><td>${esc(r.name)} · ${r.type}-Si</td><td>${r.startUm} → ${r.endUm}</td><td>${r.lengthUm}</td><td>${s} → ${s+r.lengthUm}</td></tr>`;}).join('')}</tbody></table></div><p class="view-note">起点：${esc(m.boundaries.start.assumption)}<br>终点：${esc(m.boundaries.end.assumption)}</p><details class="physics-conditions"><summary>适用性检查通过 · ${m.checks.length} 项</summary>${m.checks.map(c=>`<p>${esc(c)}</p>`).join('')}<p>使用体硅模型；侧面绝缘、无表面电荷；不包含边缘场与栅控。</p></details>`;
      $('#device-solve').disabled=!this.api||this.busy||this.running;
    }catch(e){this.mapping=null;$('#device-preview').innerHTML=`<p class="error-message">不能求解：${esc(e.message)}</p>`;}
  }
  async solve(){
    if(this.busy||this.pathDirty||this.regionDirty||!this.api)return;const generation=this.generation;this.busy=true;$('#device-solve').disabled=true;
    try{
      mapDevice(this.getProject(),this.getThrough());const ids=this.config().jobs||[];if(ids.length>=100)throw Error('当前项目已有 100 个平衡任务，请建立新项目。');
      const job=await this.api.start(this.getProject(),this.getThrough());if(generation!==this.generation)return;
      const p=structuredClone(this.config());p.jobs=[...ids,job.id];this.commit(p);this.selected=job.id;this.resultKey='';$('#device-status').textContent='正在后台求解与检查物理网格…';await this.refresh();
    }catch(e){if(generation===this.generation)this.error(e);}finally{this.busy=false;this.preview();}
  }
  async refresh(){
    if(!this.api||this.refreshing)return;this.refreshing=true;const generation=this.generation;
    try{
      const jobs=await this.api.list(this.config()?.jobs||[]);if(generation!==this.generation)return;
      if(!jobs.some(j=>j.id===this.selected))this.selected=jobs.find(j=>j.state==='running')?.id||'';
      $('#device-jobs').innerHTML=jobs.map((j,i)=>option(j.id,`${i+1} · ${states[j.state]||j.state} · ${j.id.slice(0,8)}`,this.selected)).join('')||'<option value="">尚无任务</option>';
      this.running=jobs.some(j=>j.state==='running');const job=jobs.find(j=>j.id===this.selected);
      $('#device-cancel').disabled=job?.state!=='running';$('#device-solve').disabled=this.running||this.busy||!this.mapping||!this.bound||this.pathDirty||this.regionDirty;
      if(!job){this.info=null;this.resultKey='';this.showResult(null);this.renderResultBinding();return;}
      $('#device-status').textContent=`${states[job.state]||job.state}${job.message?' · '+job.message:''}`;
      const key=job.id+':'+job.state;
      if(key!==this.resultKey){
        const info=await this.api.inspect(job.id);if(generation!==this.generation||this.selected!==job.id)return;
        this.info=info;this.resultKey=key;this.showResult(info.result?{...info.result,task:{id:job.id,inputHash:info.manifest.inputHash,createdAt:info.manifest.createdAt}}:null);
        if(info.result)$('#device-model-settings').open=false;
      }
      this.renderResultBinding();
    }catch(e){if(generation===this.generation){$('#device-status').textContent='任务校验失败：'+e.message;this.info=null;this.resultKey='';this.showResult(null);}}
    finally{this.refreshing=false;}
  }
  renderResultBinding(){
    if(!this.info?.result){$('#device-result-binding').textContent='';return;}
    const current=!this.pathDirty&&!this.regionDirty&&deviceInputKey(this.getProject(),this.getThrough())===deviceInputKey(this.info.snapshot.project,this.info.snapshot.mapping.through);
    $('#device-result-binding').textContent=current?'当前输入对应的结果 · 数值检查与实验标定分别报告':'历史结果 · 当前工艺/物理输入已改变，曲线仍对应原任务快照';
    const key=this.info.manifest.id+':'+current;if(key===this.bindingResultKey)return;this.bindingResultKey=key;
    this.showResult({...this.info.result,history:!current,task:{id:this.info.manifest.id,inputHash:this.info.manifest.inputHash,createdAt:this.info.manifest.createdAt}});
  }
}
