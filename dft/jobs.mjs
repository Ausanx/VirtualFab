import { spawn } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,rename,readdir,copyFile,open,stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dftSnapshot,jobIdPattern,validateDft } from '../src/atomic.js';

const adapterDirectory=fileURLToPath(new URL('./',import.meta.url));
const digest=text=>createHash('sha256').update(text).digest('hex');
const jobStates=['queued','running','canceling','completed','failed','canceled','interrupted'];
const validStatus=status=>status&&jobStates.includes(status.state)&&Number.isSafeInteger(status.attempt)&&status.attempt>0;
export function wslPath(file){
  const absolute=path.win32.resolve(file);
  if(!/^[a-z]:\\/i.test(absolute))throw Error('DFT 后端需要本地磁盘路径，暂不支持网络共享。');
  return `/mnt/${absolute[0].toLowerCase()}/${absolute.slice(3).replaceAll('\\','/')}`;
}
function spawnWorker(script,args){
  const wsl=path.join(process.env.SystemRoot||'C:\\Windows','System32','wsl.exe');
  return spawn(wsl,['-d','VirtualFab-QE','-u','root','--exec','python3',wslPath(script),...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
}
function invokeWorker(script,args){
  return new Promise((resolve,reject)=>{
    const child=spawnWorker(script,args);let output='',errors='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timeout);error?reject(error):resolve(value);};
    const timeout=setTimeout(()=>{child.kill();finish(Error('DFT 后端检查超时。'));},60000);
    child.on('error',e=>finish(Error('无法启动 WSL 后端：'+e.message)));
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>3_000_000){child.kill();finish(Error('原子结构输出超过限制。'));}});
    child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-6000);});
    child.on('close',code=>{
      if(settled)return;
      try{const marker='VIRTUALFAB_DFT:',at=output.lastIndexOf(marker);if(at<0)throw Error('未收到后端数据。请运行 dft/setup.ps1。'+errors.replaceAll('\0','').slice(-2000));
        const result=JSON.parse(output.slice(at+marker.length).trim());if(code!==0||result.error)throw Error(result.error||'DFT 后端检查失败。');finish(null,result);
      }catch(e){finish(e);}
    });
  });
}
async function json(file){return JSON.parse(await readFile(file,'utf8'));}
async function atomicJson(file,value){const tmp=`${file}.${randomUUID()}.tmp`;await writeFile(tmp,JSON.stringify(value,null,2),{flag:'wx'});await rename(tmp,file);}
async function tail(file){
  let handle;try{handle=await open(file,'r');const size=(await handle.stat()).size,buffer=Buffer.alloc(Math.min(size,48000));await handle.read(buffer,0,buffer.length,Math.max(0,size-buffer.length));return buffer.toString('utf8');}
  catch(e){if(e.code==='ENOENT')return '';throw e;}finally{await handle?.close();}
}
export class DftJobs {
  constructor({root,resourcesPath,invoke=invokeWorker,launch=spawnWorker}){
    this.root=root;this.adapter=resourcesPath?path.join(resourcesPath,'dft'):adapterDirectory;
    this.invoke=invoke;this.launch=launch;this.active=null;this.starting=false;this.closing=false;
  }
  directory(id){if(typeof id!=='string'||!jobIdPattern.test(id))throw Error('DFT 任务 ID 无效。');return path.join(this.root,id);}
  async init(){
    await mkdir(this.root,{recursive:true});
    for(const entry of await readdir(this.root,{withFileTypes:true})){
      if(!entry.isDirectory()||!jobIdPattern.test(entry.name))continue;
      const directory=this.directory(entry.name),file=path.join(directory,'status.json');
      let status,original;
      try{original=await readFile(file,'utf8');status=JSON.parse(original);}
      catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
      if(!validStatus(status)||['queued','running','canceling'].includes(status.state)){
        await writeFile(path.join(directory,'cancel'),'Application restarted.');
        if(!validStatus(status)&&original!==undefined)await writeFile(path.join(directory,`status.invalid-${randomUUID()}.json`),original,{flag:'wx'});
        let attempts=[];
        try{attempts=await readdir(path.join(directory,'attempts'),{withFileTypes:true});}
        catch(e){if(e.code!=='ENOENT')throw e;}
        const attempt=Math.max(validStatus(status)?status.attempt:1,...attempts.filter(row=>row.isDirectory()&&/^[1-9]\d*$/.test(row.name)&&Number.isSafeInteger(Number(row.name))).map(row=>Number(row.name)));
        await atomicJson(file,{state:'interrupted',message:validStatus(status)?'应用中断；输入和已完成扫描保留，可恢复。':'状态缺失或损坏；旧计算已请求取消，证据保留，可恢复。',finishedAt:new Date().toISOString(),attempt});
      }
    }
  }
  async probe(){return this.invoke(path.join(this.adapter,'worker.py'),['probe']);}
  async importStructure(file,dimensionality){
    if(![2,3].includes(dimensionality)||(await stat(file)).size>2_000_000)throw Error('结构维度无效或文件超过 2 MB。');
    return this.invoke(path.join(this.adapter,'worker.py'),['import',wslPath(file),String(dimensionality)]);
  }
  async start(config){
    validateDft(config);if(this.closing)throw Error('应用正在退出。');if(this.active||this.starting)throw Error('已有原子计算正在运行。');this.starting=true;
    try{
      const snapshot=dftSnapshot(config),backend=await this.probe(),id=randomUUID(),directory=this.directory(id);
      if(this.closing)throw Error('应用正在退出。');
      await mkdir(path.join(directory,'adapter'),{recursive:true});
      const sourceHashes={};
      for(const file of ['worker.py','core.py','pseudos.json']){await copyFile(path.join(this.adapter,file),path.join(directory,'adapter',file));sourceHashes[file]=digest(await readFile(path.join(directory,'adapter',file)));}
      const content=JSON.stringify(snapshot,null,2);await writeFile(path.join(directory,'snapshot.json'),content,{flag:'wx'});
      const manifest={schemaVersion:1,id,inputHash:digest(content),config:snapshot,createdAt:new Date().toISOString(),backend,sourceHashes};
      await atomicJson(path.join(directory,'manifest.json'),manifest);
      await this.run(id,1);return {id,inputHash:manifest.inputHash};
    }finally{this.starting=false;}
  }
  async verify(id){
    const directory=this.directory(id),manifest=await json(path.join(directory,'manifest.json'));
    const content=await readFile(path.join(directory,'snapshot.json'),'utf8'),snapshot=JSON.parse(content);
    if(manifest.id!==id||digest(content)!==manifest.inputHash||JSON.stringify(snapshot)!==JSON.stringify(manifest.config))throw Error('任务输入快照已损坏或与档案不符。');
    validateDft(snapshot);
    if(Object.keys(manifest.sourceHashes||{}).sort().join(',')!=='core.py,pseudos.json,worker.py')throw Error('归档的 DFT 适配器清单不完整。');
    for(const [file,hash] of Object.entries(manifest.sourceHashes)){
      if(!['worker.py','core.py','pseudos.json'].includes(file)||digest(await readFile(path.join(directory,'adapter',file)))!==hash)throw Error('归档的 DFT 适配器已损坏。');
    }
    return manifest;
  }
  async verifyResult(id,manifest,expectedHash){
    const directory=this.directory(id),content=await readFile(path.join(directory,'result.json'),'utf8');
    if(expectedHash&&digest(content)!==expectedHash)throw Error('结果文件校验失败，数据已损坏。');
    const result=JSON.parse(content),names=['base','cutoff','density','sampling',...(manifest.config.structure.dimensionality===2?['vacuum']:[])];
    if(result.schemaVersion!==1||result.inputHash!==manifest.inputHash||JSON.stringify(result.config)!==JSON.stringify(manifest.config)||result.cases?.map(c=>c.name).join(',')!==names.join(',')||!result.baseline?.scfConverged||typeof result.sensitivity?.allWithinTolerance!=='boolean')throw Error('QE 未返回完整、匹配且收敛的结果。');
    for(const row of result.cases){
      if(!row.scfConverged||!Number.isFinite(row.totalEnergyEv)||!Number.isFinite(row.sampledGapEv)||!Object.keys(row.artifacts||{}).length)throw Error('QE 扫描结果或证据清单不完整。');
      for(const [relative,hash] of Object.entries(row.artifacts)){
        if(!/^attempts\/\d+\/(base|cutoff|density|sampling|vacuum)\/(scf|nscf|bands)\.(in|out|xml|csv)$/.test(relative)||digest(await readFile(path.join(directory,relative)))!==hash)throw Error('原始计算证据校验失败，数据已损坏。');
      }
    }
    return {result,resultHash:digest(content)};
  }
  async run(id,attempt){
    const directory=this.directory(id);
    await atomicJson(path.join(directory,'status.json'),{state:'running',attempt,startedAt:new Date().toISOString()});
    if(this.closing){await atomicJson(path.join(directory,'status.json'),{state:'interrupted',attempt,message:'应用在启动任务时关闭。'});throw Error('应用正在退出。');}
    const child=this.launch(path.join(directory,'adapter','worker.py'),['run',wslPath(directory),String(attempt)]);
    let errors='',finishCalled=false,resolveDone;
    const done=new Promise(resolve=>{resolveDone=resolve;}),active={id,done,finishing:false,cancelPromise:null};this.active=active;
    const finish=async(code,error)=>{
      if(finishCalled)return;finishCalled=true;active.finishing=true;
      let state='failed',message=error?.message||errors.replaceAll('\0','').slice(-2000)||`QE 任务退出，代码 ${code}。`;
      try{
        await active.cancelPromise;
        let resultHash;
        let canceled=false;try{await stat(path.join(directory,'cancel'));canceled=true;}catch(e){if(e.code!=='ENOENT')throw e;}
        if(canceled){state='canceled';message='计算已取消；已完成扫描保留。';}
        else if(code===0){
          const manifest=await this.verify(id),verified=await this.verifyResult(id,manifest),result=verified.result;resultHash=verified.resultHash;
          state='completed';message=result.sensitivity.allWithinTolerance?'所测参数增量满足当前容差。':'部分参数增量超过当前容差，需要继续检查。';
        }
        await atomicJson(path.join(directory,'status.json'),{state,message,attempt,resultHash,finishedAt:new Date().toISOString()});
      }catch(e){await atomicJson(path.join(directory,'status.json'),{state:'failed',message:e.message,attempt,finishedAt:new Date().toISOString()}).catch(()=>{});}
      finally{if(this.active?.id===id)this.active=null;resolveDone();}
    };
    child.on('error',error=>{void finish(null,error);});
    child.on('close',code=>{void finish(code);});
    child.stdout?.on('data',chunk=>{errors=(errors+chunk).slice(-6000);});
    child.stderr?.on('data',chunk=>{errors=(errors+chunk).slice(-6000);});
  }
  async inspect(id){
    const directory=this.directory(id);
    const manifest=await this.verify(id),status=await json(path.join(directory,'status.json'));
    if(!validStatus(status))throw Error('任务状态记录已损坏。');
    let progress=null,result=null;
    try{progress=await json(path.join(directory,'progress.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(status.state==='completed'){
      if(!status.resultHash)throw Error('结果缺少校验记录，请建立新任务。');
      result=(await this.verifyResult(id,manifest,status.resultHash)).result;
    }
    const logFile=progress?.logRelative;
    const log=logFile&&/^attempts\/\d+\/(base|cutoff|density|sampling|vacuum)\/(scf|nscf|bands)\.out$/.test(logFile)?await tail(path.join(directory,logFile)):'';
    return {id,manifest,status,progress,result,log};
  }
  async list(ids){
    if(!Array.isArray(ids)||ids.length>100)throw Error('DFT 任务列表无效。');
    const visible=[...ids];if(this.active&&!visible.includes(this.active.id))visible.push(this.active.id);
    visible.forEach(id=>this.directory(id));
    return Promise.all(visible.map(async id=>{
      try{const {manifest,status,progress}=await this.inspect(id);return {id,name:manifest.config.structure.name,createdAt:manifest.createdAt,inputHash:manifest.inputHash,status,progress};}
      catch(e){let missing=false;try{await stat(this.directory(id));}catch(error){if(error.code==='ENOENT')missing=true;else throw error;}return {id,status:{state:missing?'missing':'corrupted',message:missing?'当前电脑没有此任务数据。':e.message}};}
    }));
  }
  async cancel(id){
    const directory=this.directory(id);
    const active=this.active;
    if(active?.id!==id)throw Error('该任务当前未运行。');
    if(active.finishing){await active.done;return;}
    if(!active.cancelPromise)active.cancelPromise=(async()=>{
      await writeFile(path.join(directory,'cancel'),'User canceled.');
      const status=await json(path.join(directory,'status.json'));
      await atomicJson(path.join(directory,'status.json'),{...status,state:'canceling',message:'正在终止 QE 进程…'});
    })();
    await active.cancelPromise;
  }
  async resume(id){
    if(this.closing)throw Error('应用正在退出。');if(this.active||this.starting)throw Error('已有原子计算正在运行。');this.starting=true;
    try{
      const directory=this.directory(id);await this.verify(id);const status=await json(path.join(directory,'status.json'));
      if(!['failed','interrupted','canceled'].includes(status.state))throw Error('仅能恢复失败、中断或取消的任务。');
      await this.invoke(path.join(directory,'adapter','worker.py'),['idle',wslPath(directory)]);
      const {rm}=await import('node:fs/promises');await rm(path.join(directory,'cancel'),{force:true});
      await this.run(id,(status.attempt||1)+1);return {id};
    }finally{this.starting=false;}
  }
  async close(){this.closing=true;if(this.active){const {id,done}=this.active;await this.cancel(id);await done;}}
}
