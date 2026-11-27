import type { EncryptedVaultEnvelope, VaultPayload } from '../types/finance';

const DB_NAME = 'clearledger_local_vault';
const DB_VERSION = 1;
const STORE_NAME = 'vault_records';
const RECORD_KEY = 'primary_vault';
const PBKDF2_ITERATIONS = 310_000;

export interface StoredVaultRecord {
  mode: 'plaintext_local' | 'encrypted_aes_gcm';
  updatedAt: string;
  plaintext?: VaultPayload;
  envelope?: EncryptedVaultEnvelope;
}

function openVaultDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptVaultPayload(
  payload: VaultPayload,
  passphrase: string
): Promise<EncryptedVaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);

  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encoded
  );
  const cipherBytes = new Uint8Array(cipherBuffer);

  return {
    format: 'clearledger-e2ee-v1',
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(cipherBytes),
    updatedAt: new Date().toISOString(),
    byteLength: cipherBytes.byteLength,
  };
}

export async function decryptVaultEnvelope(
  envelope: EncryptedVaultEnvelope,
  passphrase: string
): Promise<VaultPayload> {
  const salt = base64ToBytes(envelope.saltBase64);
  const iv = base64ToBytes(envelope.ivBase64);
  const cipherBytes = base64ToBytes(envelope.ciphertextBase64);
  const key = await deriveAesKey(passphrase, salt, envelope.iterations || PBKDF2_ITERATIONS);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    cipherBytes.buffer as ArrayBuffer
  );

  const decoded = new TextDecoder().decode(plainBuffer);
  return JSON.parse(decoded) as VaultPayload;
}

export async function readVaultRecord(): Promise<StoredVaultRecord | null> {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
    req.onsuccess = () => resolve((req.result as StoredVaultRecord | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function savePlaintextLocalVault(payload: VaultPayload): Promise<void> {
  const db = await openVaultDB();
  const record: StoredVaultRecord = {
    mode: 'plaintext_local',
    updatedAt: new Date().toISOString(),
    plaintext: payload,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveEncryptedLocalVault(envelope: EncryptedVaultEnvelope): Promise<void> {
  const db = await openVaultDB();
  const record: StoredVaultRecord = {
    mode: 'encrypted_aes_gcm',
    updatedAt: envelope.updatedAt,
    envelope,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function shredLocalVault(): Promise<void> {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function isEncryptedEnvelope(data: unknown): data is EncryptedVaultEnvelope {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.format === 'clearledger-e2ee-v1' &&
    typeof obj.saltBase64 === 'string' &&
    typeof obj.ivBase64 === 'string' &&
    typeof obj.ciphertextBase64 === 'string'
  );
}
