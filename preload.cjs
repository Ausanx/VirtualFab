const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('virtualFabFiles', {
  open: () => ipcRenderer.invoke('project:open'),
  save: (project, saveAs) => ipcRenderer.invoke('project:save', project, saveAs),
  reset: () => ipcRenderer.invoke('project:reset'),
  exportCsv: (name,content) => ipcRenderer.invoke('data:export-csv',name,content),
});
contextBridge.exposeInMainWorld('virtualFabPhysics', {
  equilibrium: config => ipcRenderer.invoke('physics:equilibrium', config),
});
