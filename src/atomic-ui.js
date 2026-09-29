import { atomicTemplate,validateDft,dftSnapshot } from './atomic.js';
import { AtomicViewer,drawAtomicBands } from './atomic-viewer.js';
import { escapeHtml as esc } from './viewer.js';

const $=s=>document.querySelector(s);
const states={running:'运行中',canceling:'取消中',completed:'已完成',failed:'失败',canceled:'已取消',interrupted:'已中断',missing:'本机数据缺失',corrupted:'数据校验失败'};
const cases={base:'基准',cutoff:'截断能',density:'电荷密度 k 网格',sampling:'能带采样 k 网格',vacuum:'真空层'};
export class AtomicUI{
  constructor({getProject,setConfig,toast}){
    this.getProject=getProject;this.setConfig=setConfig;this.toast=toast;this.api=window.virtualFabDft;this.generation=0;this.selected='';this.busy=false;this.invalid=false;
    $('#atomic-load').onclick=()=>{const d=atomicTemplate($('#atomic-template').value);d.jobs=[...(this.config().jobs||[])];this.commit(d);this.renderConfig();};
    $('#atomic-apply-structure').onclick=()=>{
      try{const d=structuredClone(this.config());d.structure=JSON.parse($('#atomic-structure-json').value);validateDft(d);this.commit(d);this.renderConfig();$('#atomic-structure-error').textContent='';}
      catch(e){$('#atomic-structure-error').textContent=e.message;}
    };
    $('#atomic-structure-json').oninput=()=>{$('#atomic-structure-error').textContent='坐标修改尚未应用。';};
    $('#atomic-import').onclick=async()=>{
      if(!this.api)return;const generation=this.generation;
      this.setBusy(true);
      try{const structure=await this.api.importStructure(Number($('#atomic-dimensionality').value));if(structure&&generation===this.generation){const d=structuredClone(this.config());d.structure=structure;validateDft(d);this.commit(d);this.renderConfig();}}
      catch(e){this.toast('结构导入失败：'+e.message);}finally{this.setBusy(false);}
    };
    $('#atomic-probe').onclick=()=>this.probe();$('#atomic-fit').onclick=()=>this.viewer?.fit();
    $('#atomic-form').oninput=()=>{
      this.invalid=false;
      try{const d=structuredClone(this.config());for(const input of $('#atomic-form').elements)d.settings[input.name]=Number(input.value);validateDft(d);this.commit(d);}
      catch(e){this.invalid=true;$('#atomic-status').textContent=e.message;$('#atomic-binding').textContent='参数无效；历史任务结果不对应当前表单。';}
      this.controls();
    };
    $('#atomic-form').onsubmit=async e=>{
      e.preventDefault();if(!this.api||this.busy||this.invalid)return;
      const generation=this.generation;
      try{
        const d=structuredClone(this.config());d.jobs||=[];validateDft(d);if(d.jobs.length>=100)throw Error('当前项目已包含 100 个任务，请建立新项目。');
        this.setConfig(d);this.setBusy(true);$('#atomic-status').textContent='正在建立输入快照…';
        const job=await this.api.start(d);if(generation!==this.generation){await this.refresh();return;}d.jobs.push(job.id);this.setConfig(d);this.selected=job.id;
        $('#atomic-log').open=true;$('#atomic-settings').open=false;await this.refresh();
      }catch(error){if(generation===this.generation)$('#atomic-status').textContent=error.message;}
      finally{this.setBusy(false);}
    };
    $('#atomic-jobs').onchange=()=>{this.selected=$('#atomic-jobs').value;this.resultKey='';void this.refresh();};
    $('#atomic-cancel').onclick=async()=>{try{await this.api.cancel(this.selected);await this.refresh();}catch(e){this.toast(e.message);}};
    $('#atomic-resume').onclick=async()=>{this.setBusy(true);try{await this.api.resume(this.selected);$('#atomic-log').open=true;await this.refresh();}catch(e){this.toast(e.message);}finally{this.setBusy(false);}};
    $('#atomic-reveal').onclick=()=>this.api.reveal(this.selected).catch(e=>this.toast(e.message));
    this.updateProject();this.poll=setInterval(()=>{if(!$('#atomic-view').hidden)void this.refresh();},2500);
  }
  config(){return this.getProject().dft||atomicTemplate();}
  commit(d){validateDft(d);this.invalid=false;this.setConfig(d);this.renderBinding();this.controls();}
  setBusy(value){
    this.busy=value;
    for(const input of $('#atomic-form').elements)input.disabled=value;
    for(const id of ['new-project','open-project','save-project','save-as-project','load-template','atomic-load','atomic-import','atomic-probe','atomic-dimensionality','atomic-apply-structure','atomic-template'])$('#'+id).disabled=value||(!this.api&&['atomic-import','atomic-probe'].includes(id));
    this.controls();
  }
  controls(){
    const state=this.info?.status.state;
    $('#atomic-run').disabled=!this.api||this.busy||this.invalid||this.localRunning;
    $('#atomic-cancel').disabled=this.busy||state!=='running';
    $('#atomic-resume').disabled=!this.api||this.busy||this.localRunning||!['failed','canceled','interrupted'].includes(state);
    $('#atomic-reveal').disabled=!this.api||!this.info?.manifest;
  }
  updateProject(){
    this.generation++;this.selected=(this.config().jobs||[]).at(-1)||'';this.invalid=false;this.localRunning=false;this.clearJob();
    this.renderConfig();this.controls();this.setBusy(this.busy);void this.refresh();
    if(!this.api)$('#atomic-backend').textContent='本地 DFT 后端仅在桌面版运行。';
  }
  clearJob(){
    this.info=null;this.resultKey='';
    if(!this.invalid)$('#atomic-status').textContent='尚未计算';
    $('#atomic-result').innerHTML='';$('#atomic-band-plot').innerHTML='';$('#atomic-log-text').textContent='';$('#atomic-provenance-text').textContent='';
    this.renderBinding();
  }
  renderConfig(){
    const d=this.config(),s=d.structure;$('#atomic-name').textContent=s.name;$('#atomic-size').textContent=`${s.symbols.length} 原子 · ${s.dimensionality}D · Å`;
    $('#atomic-dimensionality').value=String(s.dimensionality);$('#atomic-structure-json').value=JSON.stringify(s,null,2);
    $('#atomic-model-info').innerHTML=`<dl class="summary-list"><dt>结构</dt><dd>${esc(s.name)}</dd><dt>原子数</dt><dd>${s.symbols.length}</dd><dt>周期</dt><dd>${s.dimensionality===2?'二维薄层 · Z 真空':'三维晶体'}</dd><dt>泛函</dt><dd>PBE</dd><dt>模型</dt><dd>中性 · 非磁性 · 无 SOC</dd><dt>几何</dt><dd>固定坐标 · 未弛豫</dd><dt>占据</dt><dd>固定占据</dd></dl><hr class="section-line"><h3>结构来源</h3><p class="view-note">${esc(s.source)}</p>`;
    for(const input of $('#atomic-form').elements)input.value=d.settings[input.name];
    this.viewer?.update(s);
  }
  show(){
    if(!this.viewer){try{this.viewer=new AtomicViewer($('#atomic-scene'));this.viewer.update(this.config().structure);}catch(e){$('#atomic-scene').textContent='原子三维视图不可用：'+e.message;}}
    this.viewer?.resize();if(this.api&&!this.probed)void this.probe();void this.refresh();
  }
  async probe(){
    if(!this.api||this.probing)return;this.probing=true;$('#atomic-probe').disabled=true;$('#atomic-backend').textContent='正在检查本地计算环境…';
    try{const result=await this.api.probe();this.probed=true;$('#atomic-backend').textContent=`${result.engine} · ASE ${result.aseVersion} · Si/Mo/S 赝势校验通过`;}
    catch(e){$('#atomic-backend').textContent='后端未就绪：'+e.message;}
    finally{this.probing=false;$('#atomic-probe').disabled=this.busy;}
  }
  async refresh(){
    if(!this.api||this.refreshing)return;this.refreshing=true;const generation=this.generation;
    try{
      const projectJobs=this.config().jobs||[],list=await this.api.list(projectJobs);if(generation!==this.generation)return;
      this.localRunning=list.some(job=>['running','canceling'].includes(job.status.state));
      $('#atomic-jobs').innerHTML=list.length?list.map(job=>`<option value="${job.id}">${projectJobs.includes(job.id)?'':'其他项目 · '}${esc(job.name||job.id.slice(0,8))} · ${states[job.status.state]||job.status.state} · ${job.id.slice(0,8)}</option>`).join(''):'<option value="">尚无任务</option>';
      if(!list.some(job=>job.id===this.selected))this.selected=list.at(-1)?.id||'';$('#atomic-jobs').value=this.selected;
      if(this.selected){
        const summary=list.find(job=>job.id===this.selected);
        if(['missing','corrupted'].includes(summary.status.state)){this.info=summary;this.renderJob();return;}
        const info=await this.api.inspect(this.selected);if(generation!==this.generation||info.id!==this.selected)return;
        this.info=info;this.renderJob();
      }else this.clearJob();
    }catch(e){if(generation===this.generation)$('#atomic-status').textContent='任务读取失败：'+e.message;}
    finally{this.refreshing=false;this.controls();}
  }
  renderBinding(){
    if(this.invalid){$('#atomic-binding').textContent='参数无效；历史任务结果不对应当前表单。';$('#atomic-binding').classList.add('historical');return;}
    if(!this.info?.manifest){$('#atomic-binding').textContent='';$('#atomic-binding').classList.remove('historical');return;}
    const same=!this.invalid&&JSON.stringify(dftSnapshot(this.config()))===JSON.stringify(this.info.manifest.config);
    $('#atomic-binding').textContent=same?'此任务对应当前已应用结构与参数。':'历史任务：输入与当前已应用结构或参数不同。';
    $('#atomic-binding').classList.toggle('historical',!same);
  }
  renderJob(){
    const {status,progress,result,manifest,log}=this.info;
    if(!this.invalid)$('#atomic-status').textContent=`${states[status.state]||status.state}${progress?.case?' · '+cases[progress.case]+' / '+progress.stage:''}${progress?.totalCases?' · '+progress.completedCases+'/'+progress.totalCases+' 组':''}${status.message?' · '+status.message:''}`;
    $('#atomic-log-text').textContent=log||'';this.renderBinding();
    const key=`${this.info.id}|${status.state}`;if(key===this.resultKey)return;this.resultKey=key;
    $('#atomic-result').innerHTML='';$('#atomic-band-plot').innerHTML='';$('#atomic-provenance-text').textContent=manifest?JSON.stringify({id:this.info.id,inputSha256:manifest.inputHash,createdAt:manifest.createdAt,backend:manifest.backend,adapterHashes:manifest.sourceHashes,input:manifest.config},null,2):status.message;
    if(!result)return;
    const base=result.baseline,t=result.config.settings;
    $('#atomic-result').innerHTML=`<div class="analysis-title"><h2>网格采样结果</h2><span>PBE · Kohn–Sham</span></div><table class="data-table"><tbody><tr><td>采样带隙 (eV)</td><td>${base.sampledGapEv.toFixed(6)}</td></tr><tr><td>总能量 (eV/晶胞)</td><td>${base.totalEnergyEv.toFixed(6)}</td></tr><tr><td>不可约采样 k 点</td><td>${base.kpointCount}</td></tr><tr><td>带数 / 占据带数</td><td>${base.bandCount} / ${base.occupiedBands}</td></tr></tbody></table><div class="table-scroll"><table class="data-table"><caption>所测增量 · 容差 ${t.energyToleranceMevAtom} meV/原子、${t.gapToleranceEv} eV</caption><thead><tr><th>扫描</th><th>ΔE (meV/原子)</th><th>ΔEg (eV)</th><th>判断</th></tr></thead><tbody>${result.sensitivity.checks.map(row=>`<tr><td>${cases[row.name]}</td><td>${row.energyDifferenceMevAtom.toFixed(4)}</td><td>${row.gapDifferenceEv.toFixed(5)}</td><td>${row.withinTolerance?'满足容差':'需加密'}</td></tr>`).join('')}</tbody></table></div><p class="view-note">网格可能遗漏点间极值。单次增量检查不等于渐近收敛或实验准确；当前结构未弛豫。能量使用内部参考，不是真空带边、光学或准粒子带隙。未包含界面、缺陷、掺杂与器件输运。</p>${base.pathWarning?`<p class="error-message">${esc(base.pathWarning)}</p>`:''}`;
    drawAtomicBands($('#atomic-band-plot'),base.bands,base.occupiedBands);
  }
}
