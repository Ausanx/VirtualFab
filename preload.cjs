const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('virtualFabFiles', {
  open: () => ipcRenderer.invoke('project:open'),
  save: (project, saveAs) => ipcRenderer.invoke('project:save', project, saveAs),
  reset: () => ipcRenderer.invoke('project:reset'),
});
