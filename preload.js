const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('x68app', {
  version: () => ipcRenderer.invoke('app-version'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdate: cb => ipcRenderer.on('update-status', (_e, s) => cb(s)),
  // taskbar icon
  trayState: s => ipcRenderer.send('tray-state', s),
  onTrayProfile: cb => ipcRenderer.on('tray-profile', (_e, p) => cb(p)),
});
