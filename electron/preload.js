'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bbbNative', {
  platform: process.platform,
  requestMicAccess: () => ipcRenderer.invoke('bbb:mic-access'),
  saveFile: (name, data, filters) => ipcRenderer.invoke('bbb:save-file', { name, data, filters }),
  reveal: (p) => ipcRenderer.invoke('bbb:reveal', p),
  onMenu: (fn) => ipcRenderer.on('menu', (e, cmd) => fn(cmd))
});
