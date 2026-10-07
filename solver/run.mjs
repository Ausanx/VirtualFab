import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEquilibrium } from '../src/equilibrium.js';

const root=fileURLToPath(new URL('../',import.meta.url));
export function solveEquilibrium(config,{resourcesPath,python=false,signal}={}) {
  validateEquilibrium(config);
  const executable=python?path.join(root,'.venv-solver/Scripts/python.exe'):path.join(resourcesPath||path.join(root,'solver-bin'),'VirtualFabSolver/VirtualFabSolver.exe');
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Error('平衡任务已取消。'));return;}
    const child=spawn(executable,python?[path.join(root,'solver/equilibrium.py')]:[],{windowsHide:true,cwd:resourcesPath||root,stdio:['pipe','pipe','pipe']});
    let output='',error='',settled=false;
    const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timeout);signal?.removeEventListener('abort',abort);err?reject(err):resolve(result);};
    const abort=()=>{child.kill();};signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>{child.kill();finish(Error('平衡求解超过 45 秒，请缩小物理网格。'));},45000);
    child.on('error',err=>finish(Error('本地求解器无法启动：'+err.message)));
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>5_000_000){child.kill();finish(Error('求解器输出超过限制。'));}});
    child.stderr.on('data',chunk=>{error=(error+chunk).slice(-4000);});
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      if(settled)return;
      if(signal?.aborted){finish(Error('平衡任务已取消。'));return;}
      try{
        const marker='VIRTUALFAB_RESULT:',at=output.lastIndexOf(marker);
        if(at<0)throw Error(error||'未收到有效求解结果。');
        const result=JSON.parse(output.slice(at+marker.length).trim());
        if(code!==0||result.error)throw Error(result.error||error||'求解失败。');
        if(result.schemaVersion!==1||!result.converged||!result.rows?.length)throw Error('静电求解未收敛。');
        finish(null,result);
      }catch(err){finish(err);}
    });
    child.stdin.end(JSON.stringify(config));
  });
}
