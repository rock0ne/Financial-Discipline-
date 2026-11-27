const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('clearledgerDesktop', {
  platform: process.platform,
  isDesktopApp: true,
});
