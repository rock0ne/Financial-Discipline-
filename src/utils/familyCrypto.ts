import type {
  CurrencyCode,
  IsaPlannerSettings,
  SavingsGoal,
  Transaction,
} from '../types/finance';
import type { AnalyticsResult } from './analyticsEngine';

const IDENTITY_DB_NAME = 'clearledger_family_identity';
const IDENTITY_DB_VERSION = 1;
const IDENTITY_STORE = 'device_keys';
const IDENTITY_RECORD_KEY = 'ecdh_p256_identity';
const CONTACTS_RECORD_KEY = 'trusted_family_contacts';
const APP_PROTOCOL_DOMAIN = 'clearledger-family-share-e2ee-v1';

export interface DeviceIdentityRecord {
  privateKey: CryptoKey; // Non-extractable ECDH P-256 private key bound to this app instance
  publicKeyJwk: JsonWebKey;
  shareCode: string; // CLF1-<base64url(spki)>
  fingerprint: string; // e.g. "4F9A-82C1"
  deviceLabel: string;
  createdAt: string;
}

export interface FamilyContact {
  id: string;
  name: string;
  shareCode: string;
  fingerprint: string;
  addedAt: string;
}

export type FamilyShareScope = 'summary_and_goals' | 'full_household_ledger';

export interface SharedHouseholdSummary {
  monthCount: number;
  dateRangeLabel: string;
  avgMonthlyIncome: number;
  avgMonthlyEssential: number;
  avgMonthlyNonEssential: number;
  avgMonthlySurplus: number;
  unlockedMonthlySavings: number;
  savingsRatePct: number;
  topCategories: Array<{
    label: string;
    spendingClass: string;
    monthlyAverage: number;
    shareOfSpendingPct: number;
  }>;
}

export interface FamilySharePayload {
  schema: 'clearledger-family-payload-v1';
  senderName: string;
  senderFingerprint: string;
  sharedAt: string;
  scope: FamilyShareScope;
  currency: CurrencyCode;
  note: string;
  summary: SharedHouseholdSummary;
  goals: SavingsGoal[];
  isaSettings: IsaPlannerSettings;
  transactions?: Transaction[]; // Only included if scope === 'full_household_ledger'
}

export interface FamilyShareEnvelope {
  format: 'clearledger-family-share-v1';
  protocol: 'ECDH-P256+HKDF-SHA256+AES-256-GCM';
  senderName: string;
  senderFingerprint: string;
  recipientFingerprint: string;
  scope: FamilyShareScope;
  pinProtected: boolean;
  pinSaltBase64?: string;
  ephemeralPublicKeyJwk: JsonWebKey;
  ivBase64: string;
  aadBase64: string;
  ciphertextBase64: string;
  createdAt: string;
}

function openIdentityDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDENTITY_DB_NAME, IDENTITY_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDENTITY_STORE)) {
        db.createObjectStore(IDENTITY_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return base64ToBytes(padded);
}

async function computeFingerprintFromSpki(spkiBytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', spkiBytes.buffer as ArrayBuffer);
  const hex = Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

export async function parseFamilyShareCode(
  shareCode: string
): Promise<{ publicKey: CryptoKey; fingerprint: string }> {
  const trimmed = shareCode.trim();
  if (!trimmed.startsWith('CLF1-')) {
    throw new Error('Invalid Family Share Code. Codes begin with CLF1-.');
  }
  const b64Part = trimmed.slice(5);
  let spkiBytes: Uint8Array;
  try {
    spkiBytes = fromBase64Url(b64Part);
  } catch {
    throw new Error('Family Share Code is malformed or truncated.');
  }

  try {
    const publicKey = await crypto.subtle.importKey(
      'spki',
      spkiBytes.buffer as ArrayBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );
    const fingerprint = await computeFingerprintFromSpki(spkiBytes);
    return { publicKey, fingerprint };
  } catch {
    throw new Error('Could not verify P-256 public key inside this Family Share Code.');
  }
}

export async function getOrCreateDeviceIdentity(
  defaultLabel = 'This Clearledger Device'
): Promise<DeviceIdentityRecord> {
  const db = await openIdentityDB();
  const existing = await new Promise<DeviceIdentityRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(IDENTITY_STORE, 'readonly');
    const req = tx.objectStore(IDENTITY_STORE).get(IDENTITY_RECORD_KEY);
    req.onsuccess = () => resolve(req.result as DeviceIdentityRecord | undefined);
    req.onerror = () => reject(req.error);
  });

  if (existing && existing.privateKey && existing.shareCode) {
    return existing;
  }

  // Generate non-extractable private key so raw private material can never be exported out of this app instance
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );

  // Public key is always exportable via SPKI/JWK even when extractable is false on the pair?
  // Wait: in Web Crypto, setting extractable:false on generateKey makes BOTH keys non-exportable in some browsers!
  // Let's handle that safely: test exportKey; if browser blocks exporting public key on extractable:false,
  // re-import private key as non-extractable after extracting public key, then discard raw private bytes!
  let publicKeySpki: ArrayBuffer;
  let publicKeyJwk: JsonWebKey;
  let finalPrivateKey: CryptoKey = keyPair.privateKey;

  try {
    publicKeySpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  } catch {
    const tempPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    publicKeySpki = await crypto.subtle.exportKey('spki', tempPair.publicKey);
    publicKeyJwk = await crypto.subtle.exportKey('jwk', tempPair.publicKey);
    const privJwk = await crypto.subtle.exportKey('jwk', tempPair.privateKey);
    finalPrivateKey = await crypto.subtle.importKey(
      'jwk',
      privJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false, // Non-extractable once stored!
      ['deriveBits']
    );
  }

  const spkiBytes = new Uint8Array(publicKeySpki);
  const fingerprint = await computeFingerprintFromSpki(spkiBytes);
  const shareCode = `CLF1-${toBase64Url(spkiBytes)}`;

  const record: DeviceIdentityRecord = {
    privateKey: finalPrivateKey,
    publicKeyJwk,
    shareCode,
    fingerprint,
    deviceLabel: defaultLabel,
    createdAt: new Date().toISOString(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDENTITY_STORE, 'readwrite');
    tx.objectStore(IDENTITY_STORE).put(record, IDENTITY_RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return record;
}

export async function loadFamilyContacts(): Promise<FamilyContact[]> {
  const db = await openIdentityDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDENTITY_STORE, 'readonly');
    const req = tx.objectStore(IDENTITY_STORE).get(CONTACTS_RECORD_KEY);
    req.onsuccess = () => resolve((req.result as FamilyContact[] | undefined) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function saveFamilyContacts(contacts: FamilyContact[]): Promise<void> {
  const db = await openIdentityDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDENTITY_STORE, 'readwrite');
    tx.objectStore(IDENTITY_STORE).put(contacts, CONTACTS_RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deriveFamilyAesKey(
  ecdhSharedBits: ArrayBuffer,
  aadBytes: Uint8Array,
  pin?: string,
  pinSalt?: Uint8Array
): Promise<CryptoKey> {
  let keyMaterialBytes = new Uint8Array(ecdhSharedBits);

  // If optional Family PIN is provided, mix PBKDF2(PIN) with ECDH shared secret so both app key AND PIN are required
  if (pin && pin.trim().length > 0 && pinSalt) {
    const pinBase = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pin.trim()),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const pinBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: pinSalt.buffer as ArrayBuffer,
        iterations: 150_000,
        hash: 'SHA-256',
      },
      pinBase,
      256
    );
    const combined = new Uint8Array(keyMaterialBytes.length + 32);
    combined.set(keyMaterialBytes, 0);
    combined.set(new Uint8Array(pinBits), keyMaterialBytes.length);
    keyMaterialBytes = combined;
  }

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    keyMaterialBytes.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(APP_PROTOCOL_DOMAIN),
      info: aadBytes.buffer as ArrayBuffer,
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function createEncryptedFamilyShare(params: {
  senderIdentity: DeviceIdentityRecord;
  senderName: string;
  recipientShareCode: string;
  scope: FamilyShareScope;
  note: string;
  pin?: string;
  currency: CurrencyCode;
  analytics: AnalyticsResult;
  goals: SavingsGoal[];
  isaSettings: IsaPlannerSettings;
  transactions: Transaction[];
}): Promise<FamilyShareEnvelope> {
  const { publicKey: recipientPubKey, fingerprint: recipientFingerprint } =
    await parseFamilyShareCode(params.recipientShareCode);

  // Ephemeral ECDH keypair gives forward secrecy for every individual shared file
  const ephemeralPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const ephemeralPublicKeyJwk = await crypto.subtle.exportKey('jwk', ephemeralPair.publicKey);

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientPubKey },
    ephemeralPair.privateKey,
    256
  );

  const cleanPin = params.pin?.trim() ?? '';
  const pinProtected = cleanPin.length > 0;
  const pinSalt = pinProtected ? crypto.getRandomValues(new Uint8Array(16)) : undefined;

  const createdAt = new Date().toISOString();
  const aadString = JSON.stringify({
    app: APP_PROTOCOL_DOMAIN,
    senderFingerprint: params.senderIdentity.fingerprint,
    recipientFingerprint,
    scope: params.scope,
    pinProtected,
    createdAt,
  });
  const aadBytes = new TextEncoder().encode(aadString);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const aesKey = await deriveFamilyAesKey(sharedBits, aadBytes, cleanPin, pinSalt);

  const summary: SharedHouseholdSummary = {
    monthCount: params.analytics.monthCount,
    dateRangeLabel: params.analytics.dateRangeLabel,
    avgMonthlyIncome: Math.round(params.analytics.avgMonthlyIncome),
    avgMonthlyEssential: Math.round(params.analytics.avgMonthlyEssential),
    avgMonthlyNonEssential: Math.round(params.analytics.avgMonthlyNonEssential),
    avgMonthlySurplus: Math.round(params.analytics.avgMonthlySurplus),
    unlockedMonthlySavings: Math.round(params.analytics.totalRecommendedMonthlySavings),
    savingsRatePct: Math.round(params.analytics.savingsRatePct * 10) / 10,
    topCategories: params.analytics.categoryDrains.slice(0, 8).map((c) => ({
      label: c.label,
      spendingClass: c.spendingClass,
      monthlyAverage: Math.round(c.monthlyAverage),
      shareOfSpendingPct: Math.round(c.shareOfSpendingPct * 10) / 10,
    })),
  };

  const payload: FamilySharePayload = {
    schema: 'clearledger-family-payload-v1',
    senderName: params.senderName.trim() || 'Household Member',
    senderFingerprint: params.senderIdentity.fingerprint,
    sharedAt: createdAt,
    scope: params.scope,
    currency: params.currency,
    note: params.note.trim(),
    summary,
    goals: params.goals,
    isaSettings: params.isaSettings,
    ...(params.scope === 'full_household_ledger'
      ? { transactions: params.transactions }
      : {}),
  };

  const plainBytes = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer as ArrayBuffer,
      additionalData: aadBytes.buffer as ArrayBuffer,
    },
    aesKey,
    plainBytes
  );

  return {
    format: 'clearledger-family-share-v1',
    protocol: 'ECDH-P256+HKDF-SHA256+AES-256-GCM',
    senderName: payload.senderName,
    senderFingerprint: params.senderIdentity.fingerprint,
    recipientFingerprint,
    scope: params.scope,
    pinProtected,
    ...(pinSalt ? { pinSaltBase64: bytesToBase64(pinSalt) } : {}),
    ephemeralPublicKeyJwk,
    ivBase64: bytesToBase64(iv),
    aadBase64: bytesToBase64(aadBytes),
    ciphertextBase64: bytesToBase64(new Uint8Array(cipherBuffer)),
    createdAt,
  };
}

export function isFamilyShareEnvelope(data: unknown): data is FamilyShareEnvelope {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.format === 'clearledger-family-share-v1' &&
    typeof obj.recipientFingerprint === 'string' &&
    typeof obj.ivBase64 === 'string' &&
    typeof obj.aadBase64 === 'string' &&
    typeof obj.ciphertextBase64 === 'string' &&
    typeof obj.ephemeralPublicKeyJwk === 'object' &&
    obj.ephemeralPublicKeyJwk !== null
  );
}

export async function decryptFamilyShareEnvelope(
  envelope: FamilyShareEnvelope,
  myIdentity: DeviceIdentityRecord,
  pin?: string
): Promise<FamilySharePayload> {
  if (envelope.recipientFingerprint !== myIdentity.fingerprint) {
    throw new Error(
      `This file was encrypted specifically for Clearledger device ${envelope.recipientFingerprint}. Your device ID is ${myIdentity.fingerprint}, so only the intended family member's app can decrypt it.`
    );
  }

  if (envelope.pinProtected && (!pin || pin.trim().length === 0)) {
    throw new Error('This family share file also requires the Family PIN set by the sender.');
  }

  const ephemeralPubKey = await crypto.subtle.importKey(
    'jwk',
    envelope.ephemeralPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPubKey },
    myIdentity.privateKey,
    256
  );

  const aadBytes = base64ToBytes(envelope.aadBase64);
  const ivBytes = base64ToBytes(envelope.ivBase64);
  const cipherBytes = base64ToBytes(envelope.ciphertextBase64);
  const pinSalt = envelope.pinSaltBase64 ? base64ToBytes(envelope.pinSaltBase64) : undefined;

  const aesKey = await deriveFamilyAesKey(sharedBits, aadBytes, pin, pinSalt);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes.buffer as ArrayBuffer,
        additionalData: aadBytes.buffer as ArrayBuffer,
      },
      aesKey,
      cipherBytes.buffer as ArrayBuffer
    );
    const decoded = new TextDecoder().decode(plainBuffer);
    return JSON.parse(decoded) as FamilySharePayload;
  } catch {
    throw new Error(
      envelope.pinProtected
        ? 'Decryption failed. Verify your Family PIN or ensure the file was not modified.'
        : 'Cryptographic authentication failed. The file may be corrupted or intended for another device.'
    );
  }
}
