const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('db:load'),
  save: (db) => ipcRenderer.invoke('db:save', db),
  openWhatsApp: (url) => ipcRenderer.invoke('wa:open', url),
  savePdf: (html, name) => ipcRenderer.invoke('bill:pdf', html, name),
  saveFile: (content, name, filters) => ipcRenderer.invoke('file:save', content, name, filters),
  openFile: (filters) => ipcRenderer.invoke('file:open', filters),
  openBackups: () => ipcRenderer.invoke('backup:open'),
});