const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('x68app', {
  version: () => ipcRenderer.invoke('app-version'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdate: cb => ipcRenderer.on('update-status', (_e, s) => cb(s)),
});
