const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('folioDesktop', {
  initialFile: () => ipcRenderer.invoke('initial-file'),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, file) => cb(file)),
});
