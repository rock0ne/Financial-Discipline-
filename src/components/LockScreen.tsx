import React, { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import type { EncryptedVaultEnvelope } from '../types/finance';

interface LockScreenProps {
  envelope: EncryptedVaultEnvelope;
  onUnlock: (passphrase: string) => Promise<void>;
  onResetVault: () => Promise<void>;
}

export const LockScreen: React.FC<LockScreenProps> = ({
  envelope,
  onUnlock,
  onResetVault,
}) => {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!passphrase) return;

    try {
      setBusy(true);
      await onUnlock(passphrase);
    } catch {
      setError('Incorrect passphrase. AES-256-GCM authentication tag could not be verified.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight font-display text-slate-900 dark:text-slate-100">
            Clearledger
          </span>
          <Lock className="w-5 h-5 text-teal-700 dark:text-teal-400" />
        </div>

        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Unlock Your Local Vault
          </h1>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Your bank statements are encrypted locally on this device ({(envelope.byteLength / 1024).toFixed(1)} KB ciphertext · PBKDF2-SHA256). Enter your passphrase to decrypt.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="vault-unlock-pass"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Master Passphrase
            </label>
            <input
              id="vault-unlock-pass"
              type="password"
              autoFocus
              required
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter passphrase"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/40"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            {busy ? 'Decrypting locally…' : 'Decrypt & Open Workspace'}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            Zero-knowledge local storage
          </span>
          {!showResetConfirm ? (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="text-slate-500 hover:text-red-600 underline cursor-pointer"
            >
              Forgot passphrase?
            </button>
          ) : (
            <button
              type="button"
              onClick={onResetVault}
              className="text-red-600 font-medium hover:underline cursor-pointer"
            >
              Wipe &amp; Reset Vault
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
