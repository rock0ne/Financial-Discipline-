const { app, BrowserWindow, dialog, ipcMain, Notification } = require('electron');
const fs = require('node:fs/promises');
const path = require('path');
const { pathToFileURL } = require('node:url');

// Must match electron-builder appId so installed Windows shortcuts can route toasts.
if (process.platform === 'win32') app.setAppUserModelId('app.clearledger.finance.studio');

const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
const expectedRendererUrl = pathToFileURL(distIndex).href;
const maxDocumentBytes = 32 * 1024 * 1024;
const documentTypes = {
  'application/pdf': { extension: '.pdf', filterExtension: 'pdf', label: 'PDF document' },
  'text/csv': { extension: '.csv', filterExtension: 'csv', label: 'CSV document' },
  'application/json': { extension: '.vault.json', filterExtension: 'json', label: 'Encrypted Clearledger vault' },
};

function decodeDocumentRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new Error('Invalid export request.');
  }
  const { fileName, mimeType, dataBase64 } = request;
  const type = documentTypes[mimeType];
  const allowedFileName = mimeType === 'application/json'
    ? /^clearledger_backup_\d{4}-\d{2}-\d{2}\.vault\.json$/.test(fileName)
    : /^clearledger_[A-Za-z0-9._-]+\.(pdf|csv)$/.test(fileName);
  if (!type || typeof fileName !== 'string' ||
      !allowedFileName ||
      !fileName.toLowerCase().endsWith(type.extension) || fileName.length > 160) {
    throw new Error('Only Clearledger PDF, CSV and encrypted vault exports can be saved.');
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
  if (mimeType === 'application/json') {
    let envelope;
    try {
      envelope = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error('Encrypted backup data is invalid.');
    }
    if (bytes.length > 15_000_000 || !envelope || typeof envelope !== 'object' ||
        Array.isArray(envelope) || Object.keys(envelope).length !== 9 ||
        envelope.format !== 'clearledger-e2ee-v1' || envelope.cipher !== 'AES-256-GCM' ||
        envelope.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(envelope.iterations) ||
        envelope.iterations < 100_000 || !Number.isInteger(envelope.byteLength) ||
        envelope.byteLength < 1 || typeof envelope.saltBase64 !== 'string' ||
        typeof envelope.ivBase64 !== 'string' ||
        typeof envelope.ciphertextBase64 !== 'string' ||
        typeof envelope.updatedAt !== 'string') {
      throw new Error('Only an encrypted Clearledger vault can be exported.');
    }
  }
  return { fileName, type, bytes };
}

let saveInProgress = false;
function isTrustedRenderer(event) {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  return Boolean(ownerWindow && !ownerWindow.isDestroyed() &&
    event.senderFrame === event.sender.mainFrame &&
    event.senderFrame?.url === expectedRendererUrl);
}

ipcMain.handle('clearledger:local-notification', async (event) => {
  if (!isTrustedRenderer(event) || !Notification.isSupported()) return false;
  new Notification({
    title: 'Clearledger alert',
    body: 'Open Clearledger to review your local alert.',
  }).show();
  return true;
});

ipcMain.handle('clearledger:local-notification-support', async (event) =>
  isTrustedRenderer(event) && Notification.isSupported()
);

ipcMain.handle('clearledger:save-document', async (event, request) => {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!isTrustedRenderer(event)) {
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
      filters: [{ name: document.type.label, extensions: [document.type.filterExtension] }],
      properties: ['dontAddToRecent'],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' };
    if (!result.filePath.toLowerCase().endsWith(document.type.extension)) {
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

  // This offline app needs no secondary windows or external navigation. Never
  // let statement content or a renderer link load an untrusted page with the
  // Clearledger preload bridge attached.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (details) => {
    if (details.url !== expectedRendererUrl &&
        !details.url.startsWith(`${expectedRendererUrl}#`)) {
      details.preventDefault();
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
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
