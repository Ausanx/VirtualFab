import { app, BrowserWindow, Menu, protocol, shell } from 'electron';
import { publicAsset } from './server.mjs';

const origin='virtualfab://app';
let window;
protocol.registerSchemesAsPrivileged([{scheme:'virtualfab',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);

if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{window?.show();window?.focus();});
  app.whenReady().then(()=>{
    protocol.handle('virtualfab',async request=>{
      try {
        const url=new URL(request.url);
        if(url.protocol!=='virtualfab:'||url.host!=='app')return new Response('Not found',{status:404});
        const asset=await publicAsset(url.pathname);
        return asset?new Response(asset.data,{headers:asset.headers}):new Response('Not found',{status:404});
      } catch {return new Response('Not found',{status:404});}
    });
    window=new BrowserWindow({title:'VirtualFab Studio',width:1440,height:920,minWidth:1080,minHeight:720,backgroundColor:'#e8ebef',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    window.webContents.setWindowOpenHandler(({url})=>{
      if(/^https?:\/\//i.test(url))shell.openExternal(url);
      return {action:'deny'};
    });
    window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/'))event.preventDefault();});
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label:'文件',submenu:[
        {label:'打开项目',accelerator:'CmdOrCtrl+O',click:()=>window?.webContents.executeJavaScript("document.getElementById('open-project').click()")},
        {label:'导出项目',accelerator:'CmdOrCtrl+S',click:()=>window?.webContents.executeJavaScript("document.getElementById('export-project').click()")},
        {type:'separator'},{role:'quit',label:'退出'}]},
      {label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},
      {label:'视图',submenu:[{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]},
    ]));
    window.loadURL(origin+'/');
  });
  app.on('window-all-closed',()=>app.quit());
}
