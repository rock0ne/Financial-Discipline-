const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clearledgerDesktop', {
  platform: process.platform,
  isDesktopApp: true,
  saveDocument: ({ fileName, mimeType, dataBase64 }) =>
    ipcRenderer.invoke('clearledger:save-document', { fileName, mimeType, dataBase64 }),
  // No renderer-supplied notification text crosses the bridge.
  showLocalNotification: () => ipcRenderer.invoke('clearledger:local-notification'),
  supportsLocalNotification: () => ipcRenderer.invoke('clearledger:local-notification-support'),
});
