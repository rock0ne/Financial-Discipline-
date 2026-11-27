import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EncryptedVaultEnvelope } from '../src/types/finance';
import { saveEncryptedVaultDocument } from '../src/utils/documentSave';

const ENVELOPE: EncryptedVaultEnvelope = {
  format: 'clearledger-e2ee-v1',
  cipher: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations: 310000,
  saltBase64: 'YWJjZA==',
  ivBase64: 'ZWZnaA==',
  ciphertextBase64: 'aWprbA==',
  updatedAt: '2026-11-27T10:00:00.000Z',
  byteLength: 4,
};

describe('encrypted native vault export', () => {
  it('sends only the allowlisted encrypted envelope and reports confirmed saves', async () => {
    let request: { fileName: string; mimeType: string; dataBase64: string } | undefined;
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        clearledgerDesktop: {
          isDesktopApp: true,
          saveDocument: async (options: typeof request) => {
            request = options;
            return { status: 'saved', fileName: 'clearledger_backup_2026-11-27.vault.json' };
          },
        },
      },
    });
    try {
      const result = await saveEncryptedVaultDocument(
        { ...ENVELOPE, plaintext: { secret: 'must-not-export' } } as EncryptedVaultEnvelope,
        'clearledger_backup_2026-11-27.vault.json'
      );
      assert.equal(result.status, 'saved');
      assert.equal(request?.mimeType, 'application/json');
      assert.equal(request?.fileName, 'clearledger_backup_2026-11-27.vault.json');
      const exported = JSON.parse(Buffer.from(request!.dataBase64, 'base64').toString('utf8'));
      assert.equal(exported.format, 'clearledger-e2ee-v1');
      assert.equal(exported.ciphertextBase64, ENVELOPE.ciphertextBase64);
      assert.equal(Object.keys(exported).length, 9);
      assert.equal('plaintext' in exported, false);
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });

  it('does not turn a cancelled native Save As into a success', async () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { clearledgerDesktop: { isDesktopApp: true,
        saveDocument: async () => ({ status: 'cancelled' }) } },
    });
    try {
      const result = await saveEncryptedVaultDocument(
        ENVELOPE, 'clearledger_backup_2026-11-27.vault.json'
      );
      assert.equal(result.status, 'cancelled');
      await assert.rejects(
        () => saveEncryptedVaultDocument(ENVELOPE, 'clearledger_plaintext.json'),
        /Invalid encrypted backup filename/
      );
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });
});
