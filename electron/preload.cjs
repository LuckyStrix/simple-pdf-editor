const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfEditorDesktop', {
  initialFile: () => ipcRenderer.invoke('initial-file'),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, file) => cb(file)),
});
