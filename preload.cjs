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
contextBridge.exposeInMainWorld('virtualFabDft', {
  probe: () => ipcRenderer.invoke('dft:probe'),
  importStructure: dimensionality => ipcRenderer.invoke('dft:import',dimensionality),
  start: config => ipcRenderer.invoke('dft:start',config),
  list: ids => ipcRenderer.invoke('dft:list',ids),
  inspect: id => ipcRenderer.invoke('dft:inspect',id),
  cancel: id => ipcRenderer.invoke('dft:cancel',id),
  resume: id => ipcRenderer.invoke('dft:resume',id),
  reveal: id => ipcRenderer.invoke('dft:reveal',id),
});
