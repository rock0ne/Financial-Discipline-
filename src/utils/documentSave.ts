import { Capacitor, registerPlugin } from '@capacitor/core';
import type { jsPDF } from 'jspdf';

export type DocumentSaveResult = {
  status: 'saved' | 'cancelled' | 'requested';
  fileName: string;
};

interface DocumentSavePlugin {
  saveDocument(options: {
    fileName: string;
    mimeType: 'application/pdf' | 'text/csv';
    dataBase64: string;
  }): Promise<{ status: 'saved' | 'cancelled'; fileName?: string }>;
}

const DocumentSave = registerPlugin<DocumentSavePlugin>('DocumentSave');

interface DesktopSaveBridge {
  isDesktopApp: boolean;
  saveDocument(options: {
    fileName: string;
    mimeType: 'application/pdf' | 'text/csv';
    dataBase64: string;
  }): Promise<{
    status: 'saved' | 'cancelled' | 'error';
    fileName?: string;
    message?: string;
  }>;
}

function desktopBridge(): DesktopSaveBridge | undefined {
  return (window as Window & { clearledgerDesktop?: DesktopSaveBridge }).clearledgerDesktop;
}

function hasConnectedSave(): boolean {
  return (Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform()) ||
    Boolean(desktopBridge()?.isDesktopApp);
}

async function saveConnectedDocument(
  fileName: string,
  mimeType: 'application/pdf' | 'text/csv',
  dataBase64: string
): Promise<DocumentSaveResult> {
  const desktop = desktopBridge();
  const result = desktop?.isDesktopApp
    ? await desktop.saveDocument({ fileName, mimeType, dataBase64 })
    : await DocumentSave.saveDocument({ fileName, mimeType, dataBase64 });
  if (result.status === 'error') {
    throw new Error(result.message || 'Document save failed');
  }
  if (result.status !== 'saved' && result.status !== 'cancelled') {
    throw new Error('The document save result was not confirmed');
  }
  return { status: result.status, fileName: result.fileName || fileName };
}

/** Native apps confirm Save As; browsers can only request a download. */
export async function savePdfDocument(doc: jsPDF, fileName: string): Promise<DocumentSaveResult> {
  if (!/^clearledger_[A-Za-z0-9._-]+\.pdf$/.test(fileName) || fileName.length > 160) {
    throw new Error('Invalid PDF filename');
  }

  if (hasConnectedSave()) {
    const dataUri = doc.output('datauristring');
    const marker = 'base64,';
    const markerAt = dataUri.indexOf(marker);
    if (markerAt < 0) throw new Error('Could not prepare the PDF for saving');
    const dataBase64 = dataUri.slice(markerAt + marker.length);
    return saveConnectedDocument(fileName, 'application/pdf', dataBase64);
  }

  // Web/Electron download APIs do not confirm that the user kept the file.
  doc.save(fileName);
  return { status: 'requested', fileName };
}

/** CSV uses user-chosen native destinations and has no automatic network upload. */
export async function saveCsvDocument(csv: string, fileName: string): Promise<DocumentSaveResult> {
  if (!/^clearledger_[A-Za-z0-9._-]+\.csv$/.test(fileName) || fileName.length > 160) {
    throw new Error('Invalid CSV filename');
  }
  if (hasConnectedSave()) {
    const bytes = new TextEncoder().encode(csv);
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 12288) {
      chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 12288))));
    }
    return saveConnectedDocument(fileName, 'text/csv', chunks.join(''));
  }

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { status: 'requested', fileName };
}
