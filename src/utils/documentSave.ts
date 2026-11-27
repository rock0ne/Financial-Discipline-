import { Capacitor, registerPlugin } from '@capacitor/core';
import type { jsPDF } from 'jspdf';
import type { EncryptedVaultEnvelope } from '../types/finance';
import { isEncryptedEnvelope } from './cryptoVault';

type SaveMimeType = 'application/pdf' | 'text/csv' | 'application/json';

export type DocumentSaveResult = {
  status: 'saved' | 'cancelled' | 'requested';
  fileName: string;
};

interface DocumentSavePlugin {
  prepareDocument(options: {
    fileName: string;
    mimeType: SaveMimeType;
    dataBase64: string;
  }): Promise<{ token: string }>;
  savePreparedDocument(options: {
    fileName: string;
    mimeType: SaveMimeType;
    token: string;
  }): Promise<{ status: 'saved' | 'cancelled'; fileName?: string }>;
  discardDocument(options: { token: string }): Promise<void>;
}

const DocumentSave = registerPlugin<DocumentSavePlugin>('DocumentSave');

interface DesktopSaveBridge {
  isDesktopApp: boolean;
  saveDocument(options: {
    fileName: string;
    mimeType: SaveMimeType;
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
  mimeType: SaveMimeType,
  dataBase64: string
): Promise<DocumentSaveResult> {
  const desktop = desktopBridge();
  let result: { status: 'saved' | 'cancelled' | 'error'; fileName?: string; message?: string };
  if (desktop?.isDesktopApp) {
    result = await desktop.saveDocument({ fileName, mimeType, dataBase64 });
  } else {
    // Do not put a large base64 payload in the call that launches Android's picker:
    // Capacitor saves that call in Activity state, which can exceed Binder's limit.
    const prepared = await DocumentSave.prepareDocument({ fileName, mimeType, dataBase64 });
    if (!/^(pdf|csv|vault)-[0-9a-f-]{36}$/.test(prepared.token)) {
      throw new Error('The prepared export token was invalid');
    }
    try {
      result = await DocumentSave.savePreparedDocument({ fileName, mimeType, token: prepared.token });
    } finally {
      // The native callback also removes the stage; this covers picker errors.
      try {
        await DocumentSave.discardDocument({ token: prepared.token });
      } catch {
        // An interrupted Activity is covered by the native one-hour stale-stage cleanup.
      }
    }
  }
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

/** Exports only the encrypted vault envelope, never the plaintext vault payload. */
export async function saveEncryptedVaultDocument(
  envelope: EncryptedVaultEnvelope,
  fileName: string
): Promise<DocumentSaveResult> {
  if (!/^clearledger_backup_\d{4}-\d{2}-\d{2}\.vault\.json$/.test(fileName)) {
    throw new Error('Invalid encrypted backup filename');
  }
  const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!isEncryptedEnvelope(envelope) || envelope.cipher !== 'AES-256-GCM' ||
      envelope.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(envelope.iterations) ||
      envelope.iterations < 100_000 || !Number.isInteger(envelope.byteLength) ||
      envelope.byteLength < 1 || typeof envelope.updatedAt !== 'string' ||
      !base64.test(envelope.saltBase64) || !base64.test(envelope.ivBase64) ||
      !base64.test(envelope.ciphertextBase64)) {
    throw new Error('Only a valid encrypted Clearledger backup may be exported');
  }

  // Construct an allowlisted envelope so accidental extra plaintext properties never leave the app.
  const encoded = JSON.stringify({
    format: 'clearledger-e2ee-v1',
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: envelope.iterations,
    saltBase64: envelope.saltBase64,
    ivBase64: envelope.ivBase64,
    ciphertextBase64: envelope.ciphertextBase64,
    updatedAt: envelope.updatedAt,
    byteLength: envelope.byteLength,
  }, null, 2);
  const bytes = new TextEncoder().encode(encoded);
  if (bytes.length > 15_000_000) {
    throw new Error('Encrypted backup is too large for this private native build');
  }

  if (hasConnectedSave()) {
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 12288) {
      chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 12288))));
    }
    return saveConnectedDocument(fileName, 'application/json', chunks.join(''));
  }

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { status: 'requested', fileName };
}
