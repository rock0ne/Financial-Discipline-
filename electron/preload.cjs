const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clearledgerDesktop', {
  platform: process.platform,
  isDesktopApp: true,
  saveDocument: ({ fileName, mimeType, dataBase64 }) =>
    ipcRenderer.invoke('clearledger:save-document', { fileName, mimeType, dataBase64 }),
});
