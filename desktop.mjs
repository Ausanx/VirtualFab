import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell } from 'electron';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicAsset } from './server.mjs';
import { validateProject } from './src/engine.js';
import { solveEquilibrium } from './solver/run.mjs';
import { DftJobs } from './dft/jobs.mjs';

const origin='virtualfab://app';
let window,currentPath=null;
let solverBusy=false;
let dftJobs,quitting=false;
ipcMain.handle('dft:probe',async event=>{fromWindow(event);return dftJobs.probe();});
ipcMain.handle('dft:import',async(event,dimensionality)=>{
  fromWindow(event);
  if(![2,3].includes(dimensionality))throw Error('原子周期维度无效。');
  const chosen=await dialog.showOpenDialog(window,{title:'导入原子结构',properties:['openFile'],filters:[{name:'原子结构',extensions:['cif','vasp','poscar','xyz','extxyz']},{name:'POSCAR',extensions:['*']}]});
  return chosen.canceled||!chosen.filePaths[0]?null:dftJobs.importStructure(chosen.filePaths[0],dimensionality);
});
ipcMain.handle('dft:start',async(event,config)=>{fromWindow(event);return dftJobs.start(config);});
ipcMain.handle('dft:list',async(event,ids)=>{fromWindow(event);return dftJobs.list(ids);});
ipcMain.handle('dft:inspect',async(event,id)=>{fromWindow(event);return dftJobs.inspect(id);});
ipcMain.handle('dft:cancel',async(event,id)=>{fromWindow(event);return dftJobs.cancel(id);});
ipcMain.handle('dft:resume',async(event,id)=>{fromWindow(event);return dftJobs.resume(id);});
ipcMain.handle('dft:reveal',async(event,id)=>{fromWindow(event);await dftJobs.verify(id);const directory=dftJobs.directory(id);shell.showItemInFolder(path.join(directory,'manifest.json'));});
const projectFilter=[{name:'VirtualFab 项目',extensions:['json']}];
function fromWindow(event){if(event.sender!==window?.webContents)throw Error('无效的项目文件请求。');}
ipcMain.handle('physics:equilibrium',async(event,config)=>{
  fromWindow(event);
  if(solverBusy)throw Error('上一次平衡求解尚未结束。');
  solverBusy=true;
  try{return await solveEquilibrium(config,{resourcesPath:app.isPackaged?process.resourcesPath:undefined});}
  finally{solverBusy=false;}
});
ipcMain.handle('project:open',async event=>{
  fromWindow(event);
  const chosen=await dialog.showOpenDialog(window,{title:'打开项目',properties:['openFile'],filters:projectFilter});
  if(chosen.canceled||!chosen.filePaths[0])return null;
  const file=chosen.filePaths[0];
  if((await stat(file)).size>2_000_000)throw Error('项目文件上限为 2 MB。');
  const project=validateProject(JSON.parse(await readFile(file,'utf8')));
  currentPath=file;
  return {project,path:file};
});
ipcMain.handle('project:save',async (event,project,saveAs=false)=>{
  fromWindow(event);
  validateProject(project);
  const content=JSON.stringify(project,null,2);
  if(Buffer.byteLength(content)>2_000_000)throw Error('项目文件上限为 2 MB。');
  let target=saveAs?null:currentPath;
  if(!target){
    const name=(project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')||'VirtualFab')+'.json';
    const chosen=await dialog.showSaveDialog(window,{title:saveAs?'另存为':'保存项目',defaultPath:path.join(app.getPath('documents'),name),filters:projectFilter});
    if(chosen.canceled||!chosen.filePath)return null;
    target=chosen.filePath;
    if(path.extname(target).toLowerCase()!=='.json')target+='.json';
  }
  const temporary=`${target}.${randomUUID()}.tmp`;
  try{await writeFile(temporary,content,{flag:'wx'});await rename(temporary,target);}
  finally{await rm(temporary,{force:true}).catch(()=>{});}
  currentPath=target;
  return {path:target};
});
ipcMain.handle('project:reset',event=>{fromWindow(event);currentPath=null;});
ipcMain.handle('data:export-csv',async(event,name,content)=>{
  fromWindow(event);
  if(typeof name!=='string'||!/^[-a-z0-9]+\.csv$/i.test(name)||typeof content!=='string'||Buffer.byteLength(content)>5_000_000)throw Error('CSV 导出数据无效或超过 5 MB。');
  const chosen=await dialog.showSaveDialog(window,{title:'导出 CSV',defaultPath:path.join(app.getPath('documents'),name),filters:[{name:'CSV 数据',extensions:['csv']}]});
  if(chosen.canceled||!chosen.filePath)return null;
  let target=chosen.filePath;if(path.extname(target).toLowerCase()!=='.csv')target+='.csv';
  const temporary=`${target}.${randomUUID()}.tmp`;
  try{await writeFile(temporary,content,{flag:'wx'});await rename(temporary,target);}
  finally{await rm(temporary,{force:true}).catch(()=>{});}
  return {path:target};
});
protocol.registerSchemesAsPrivileged([{scheme:'virtualfab',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);

if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{window?.show();window?.focus();});
  app.whenReady().then(async()=>{
    dftJobs=new DftJobs({root:path.join(app.getPath('userData'),'dft-jobs'),resourcesPath:app.isPackaged?process.resourcesPath:undefined});
    await dftJobs.init();
    protocol.handle('virtualfab',async request=>{
      try {
        const url=new URL(request.url);
        if(url.protocol!=='virtualfab:'||url.host!=='app')return new Response('Not found',{status:404});
        const asset=await publicAsset(url.pathname);
        return asset?new Response(asset.data,{headers:asset.headers}):new Response('Not found',{status:404});
      } catch {return new Response('Not found',{status:404});}
    });
    window=new BrowserWindow({title:'VirtualFab Studio',width:1440,height:920,minWidth:1080,minHeight:720,backgroundColor:'#e8ebef',webPreferences:{preload:path.join(path.dirname(fileURLToPath(import.meta.url)),'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
    window.webContents.setWindowOpenHandler(({url})=>{
      if(/^https?:\/\//i.test(url))shell.openExternal(url);
      return {action:'deny'};
    });
    window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/'))event.preventDefault();});
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label:'文件',submenu:[
        {label:'新建项目',accelerator:'CmdOrCtrl+N',click:()=>window?.webContents.executeJavaScript("document.getElementById('new-project').click()")},
        {label:'打开项目',accelerator:'CmdOrCtrl+O',click:()=>window?.webContents.executeJavaScript("document.getElementById('open-project').click()")},
        {label:'保存项目',accelerator:'CmdOrCtrl+S',click:()=>window?.webContents.executeJavaScript("document.getElementById('save-project').click()")},
        {label:'另存为',accelerator:'CmdOrCtrl+Shift+S',click:()=>window?.webContents.executeJavaScript("document.getElementById('save-as-project').click()")},
        {type:'separator'},{role:'quit',label:'退出'}]},
      {label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},
      {label:'视图',submenu:[{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]},
    ]));
    window.loadURL(origin+'/');
  });
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',event=>{
    if(!quitting&&(dftJobs?.active||dftJobs?.starting)){event.preventDefault();quitting=true;void dftJobs.close().finally(()=>app.quit());}
  });
}
