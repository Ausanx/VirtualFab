import { randomUUID,createHash } from 'node:crypto';
import { mkdir,writeFile,readFile,rename,readdir,rm } from 'node:fs/promises';
import path from 'node:path';
import { mapDevice } from '../src/device-model.js';
import { assessEquilibrium } from '../src/equilibrium.js';
import { jobIdPattern } from '../src/atomic.js';
import { solveEquilibrium } from './run.mjs';

const hash=content=>createHash('sha256').update(content).digest('hex');
async function json(file){return JSON.parse(await readFile(file,'utf8'));}
async function save(file,value){const temporary=file+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,JSON.stringify(value),{flag:'wx'});await rename(temporary,file);}finally{await rm(temporary,{force:true});}}
export class PhysicsJobs{
  constructor({root,resourcesPath,solve=solveEquilibrium}){this.root=root;this.resourcesPath=resourcesPath;this.solve=solve;this.active=null;this.starting=false;this.closing=false;}
  directory(id){if(typeof id!=='string'||!jobIdPattern.test(id))throw Error('物理任务 ID 无效。');return path.join(this.root,id);}
  async init(){
    await mkdir(this.root,{recursive:true});
    for(const entry of await readdir(this.root,{withFileTypes:true})){
      if(!entry.isDirectory()||!jobIdPattern.test(entry.name))continue;
      const file=path.join(this.directory(entry.name),'status.json');let s;
      try{s=await json(file);}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
      if(!s||!['completed','failed','canceled','interrupted'].includes(s.state))await save(file,{state:'interrupted',message:'应用中断；原输入已保留，请创建新任务重算。',finishedAt:new Date().toISOString()});
    }
  }
  async start(project,through){
    if(this.closing||this.active||this.starting)throw Error('已有本地物理任务正在运行或应用正在退出。');this.starting=true;
    try{
      const snapshot=structuredClone(project);delete snapshot.dft;delete snapshot.equilibrium;snapshot.devicePhysics.jobs=[];
      if(Buffer.byteLength(JSON.stringify(snapshot))>2_000_000)throw Error('输入快照超过 2 MB。');
      const mapping=mapDevice(snapshot,through),id=randomUUID(),directory=this.directory(id),content=JSON.stringify({project:snapshot,mapping});
      await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'snapshot.json'),content,{flag:'wx'});
      await save(path.join(directory,'manifest.json'),{schemaVersion:1,id,inputHash:hash(content),createdAt:new Date().toISOString()});
      await save(path.join(directory,'status.json'),{state:'running',startedAt:new Date().toISOString()});
      if(this.closing)throw Error('应用正在退出，未启动计算。');
      const controller=new AbortController();this.active={id,controller};
      const done=(async()=>{
        try{
          const result=assessEquilibrium(await this.solve(mapping.config,{resourcesPath:this.resourcesPath,signal:controller.signal}),mapping.config);
          if(controller.signal.aborted)throw Error('任务已取消。');
          this.active.finishing=true;
          const resultContent=JSON.stringify({...result,mapping});await writeFile(path.join(directory,'result.json'),resultContent,{flag:'wx'});
          await save(path.join(directory,'status.json'),{state:'completed',resultHash:hash(resultContent),finishedAt:new Date().toISOString()});
        }catch(e){await save(path.join(directory,'status.json'),{state:controller.signal.aborted?'canceled':'failed',message:e.message,finishedAt:new Date().toISOString()});}
        finally{if(this.active?.id===id)this.active=null;}
      })();this.active.done=done;void done.catch(()=>{});return {id};
    }finally{this.starting=false;}
  }
  async inspect(id){
    const directory=this.directory(id),manifest=await json(path.join(directory,'manifest.json')),content=await readFile(path.join(directory,'snapshot.json'),'utf8'),snapshot=JSON.parse(content),status=await json(path.join(directory,'status.json'));
    if(manifest.schemaVersion!==1||manifest.id!==id||manifest.inputHash!==hash(content))throw Error('任务输入校验失败。');
    if(!['running','completed','failed','canceled','interrupted'].includes(status.state))throw Error('任务状态无效。');
    if(JSON.stringify(mapDevice(snapshot.project,snapshot.mapping.through))!==JSON.stringify(snapshot.mapping))throw Error('任务映射与工艺输入不一致。');
    let result=null;
    if(status.state==='completed'){
      const resultContent=await readFile(path.join(directory,'result.json'),'utf8');if(hash(resultContent)!==status.resultHash)throw Error('任务结果校验失败。');
      result=JSON.parse(resultContent);assessEquilibrium(result,snapshot.mapping.config);
      if(JSON.stringify(result.mapping)!==JSON.stringify(snapshot.mapping))throw Error('结果映射不一致。');
    }
    return {manifest,status,snapshot,result};
  }
  async list(ids){
    if(!Array.isArray(ids)||ids.length>100)throw Error('物理任务列表无效。');
    const visible=[...ids];if(this.active&&!visible.includes(this.active.id))visible.push(this.active.id);
    return Promise.all(visible.map(async id=>{try{const directory=this.directory(id),status=await json(path.join(directory,'status.json'));if(!['running','completed','failed','canceled','interrupted'].includes(status.state))throw Error('任务状态无效。');return {id,...status};}catch(e){return {id,state:e.code==='ENOENT'?'missing':'corrupted',message:e.message};}}));
  }
  async cancel(id){if(this.active?.id!==id)throw Error('任务当前未运行。');if(!this.active.finishing)this.active.controller.abort();await this.active.done;}
  async close(){this.closing=true;if(this.active){if(!this.active.finishing)this.active.controller.abort();await this.active.done;}}
}
