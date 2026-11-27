const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('path');
const { pathToFileURL } = require('node:url');

const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
const expectedRendererUrl = pathToFileURL(distIndex).href;
const maxDocumentBytes = 32 * 1024 * 1024;
const documentTypes = {
  'application/pdf': { extension: '.pdf', label: 'PDF document' },
  'text/csv': { extension: '.csv', label: 'CSV document' },
};

function decodeDocumentRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new Error('Invalid export request.');
  }
  const { fileName, mimeType, dataBase64 } = request;
  const type = documentTypes[mimeType];
  if (!type || typeof fileName !== 'string' ||
      !/^clearledger_[A-Za-z0-9._-]+\.(pdf|csv)$/.test(fileName) ||
      !fileName.toLowerCase().endsWith(type.extension) || fileName.length > 160) {
    throw new Error('Only Clearledger PDF and CSV exports can be saved.');
  }
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0 ||
      dataBase64.length > Math.ceil(maxDocumentBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)) {
    throw new Error('Invalid or oversized export data.');
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length === 0 || bytes.length > maxDocumentBytes) {
    throw new Error('Invalid or oversized export data.');
  }
  if (mimeType === 'application/pdf' && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('PDF export data is invalid.');
  }
  if (mimeType === 'text/csv' && bytes.includes(0)) {
    throw new Error('CSV export data is invalid.');
  }
  return { fileName, type, bytes };
}

let saveInProgress = false;
ipcMain.handle('clearledger:save-document', async (event, request) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!ownerWindow || ownerWindow.isDestroyed() ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame?.url !== expectedRendererUrl) {
    return { status: 'error', message: 'Untrusted export request was refused.' };
  }
  if (saveInProgress) {
    return { status: 'error', message: 'Another Save As dialog is already open.' };
  }

  let document;
  try {
    document = decodeDocumentRequest(request);
  } catch (error) {
    return { status: 'error', message: error.message };
  }

  saveInProgress = true;
  try {
    const result = await dialog.showSaveDialog(ownerWindow, {
      title: `Save ${document.type.label}`,
      defaultPath: path.join(app.getPath('downloads'), document.fileName),
      buttonLabel: 'Save',
      filters: [{ name: document.type.label, extensions: [document.type.extension.slice(1)] }],
      properties: ['dontAddToRecent'],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' };
    if (path.extname(result.filePath).toLowerCase() !== document.type.extension) {
      return { status: 'error', message: `Choose a ${document.type.extension} file name.` };
    }
    await fs.writeFile(result.filePath, document.bytes);
    return { status: 'saved', fileName: path.basename(result.filePath) };
  } catch {
    return { status: 'error', message: 'Could not write the selected file.' };
  } finally {
    saveInProgress = false;
  }
});

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Clearledger — Private Bank Statement & Savings Planner',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'pwa-512x512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the locally built offline Vite bundle
  mainWindow.loadFile(distIndex);

  // Open external http/https links in the system browser instead of inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
