import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Download,
  FileSpreadsheet,
  History,
  KeyRound,
  Lock,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  CURRENCY_CONFIG,
  DEFAULT_EXCHANGE_RATES,
  convertAmount,
  formatMoney,
  type AiAssistantSettings,
  type AiProviderSetting,
  type AiRetentionOption,
  type CurrencyCode,
  type EncryptedVaultEnvelope,
  type ExchangeRateTable,
  type StatementImportMeta,
  type Transaction,
} from '../types/finance';
import {
  AI_PROVIDER_LABELS,
  AI_RETENTION_OPTIONS,
  formatRemainingRetention,
  type ProviderAvailabilityMap,
} from '../utils/aiSettings';
import type { DocumentSaveResult } from '../utils/documentSave';
import { redactImportDisplayText } from '../utils/displayPrivacy';

interface VaultSecurityViewProps {
  isEncrypted: boolean;
  envelope: EncryptedVaultEnvelope | null;
  currency: CurrencyCode;
  exchangeRates?: Partial<ExchangeRateTable>;
  darkMode: boolean;
  transactionCount: number;
  transactions: Transaction[];
  imports: StatementImportMeta[];
  isSampleData: boolean;
  aiSettings: AiAssistantSettings;
  providerStatus: ProviderAvailabilityMap | null;
  onUpdateAiProvider: (provider: AiProviderSetting) => void;
  onUpdateAiRetention: (retention: AiRetentionOption) => void;
  onUpdateAiRatiosOnly: (ratiosOnly: boolean) => void;
  onForgetAiSession: () => void;
  onNavigateAi: () => void;
  onEnableEncryption: (passphrase: string) => Promise<void>;
  onLockVaultNow: () => void;
  onDisableEncryption: () => Promise<void>;
  onExportEncryptedVault: (passphraseOverride?: string) => Promise<DocumentSaveResult>;
  onImportEncryptedVault: (file: File, passphrase: string) => Promise<string>;
  onDeleteImportBatch: (
    importId: string
  ) => Promise<{ removedTransactions: number; fileName: string }>;
  onOpenImport: () => void;
  onCurrencyChange: (c: CurrencyCode) => void;
  onUpdateExchangeRates: (rates: Partial<ExchangeRateTable>) => void;
  onToggleDarkMode: () => void;
  onResetSampleData: () => Promise<void>;
  onShredAllData: () => Promise<void>;
}

function formatImportTimestamp(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const VaultSecurityView: React.FC<VaultSecurityViewProps> = ({
  isEncrypted,
  envelope,
  currency,
  exchangeRates,
  darkMode,
  transactionCount,
  transactions,
  imports,
  isSampleData,
  aiSettings,
  providerStatus,
  onUpdateAiProvider,
  onUpdateAiRetention,
  onUpdateAiRatiosOnly,
  onForgetAiSession,
  onNavigateAi,
  onEnableEncryption,
  onLockVaultNow,
  onDisableEncryption,
  onExportEncryptedVault,
  onImportEncryptedVault,
  onDeleteImportBatch,
  onOpenImport,
  onCurrencyChange,
  onUpdateExchangeRates,
  onToggleDarkMode,
  onResetSampleData,
  onShredAllData,
}) => {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [exportPass, setExportPass] = useState('');
  const [importPass, setImportPass] = useState('');
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [confirmShred, setConfirmShred] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);
  const [importSortOrder, setImportSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [confirmDeleteBatchId, setConfirmDeleteBatchId] = useState<string | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sortedImports = useMemo(() => {
    const copy = [...imports];
    copy.sort((a, b) => {
      const timeA = Date.parse(a.importedAt) || 0;
      const timeB = Date.parse(b.importedAt) || 0;
      return importSortOrder === 'newest' ? timeB - timeA : timeA - timeB;
    });
    return copy;
  }, [imports, importSortOrder]);

  // Compute live ledger rows currently linked to each import batch
  const activeRowsByBatchId = useMemo(() => {
    const fileCountMap = new Map<string, number>();
    for (const imp of imports) {
      fileCountMap.set(imp.fileName, (fileCountMap.get(imp.fileName) ?? 0) + 1);
    }

    const map = new Map<string, number>();
    for (const imp of imports) {
      const uniqueFileName = (fileCountMap.get(imp.fileName) ?? 0) === 1;
      let count = 0;
      for (const tx of transactions) {
        if (tx.importBatchId) {
          if (tx.importBatchId === imp.id) count++;
        } else if (uniqueFileName && tx.sourceFile === imp.fileName) {
          count++;
        }
      }
      map.set(imp.id, count);
    }
    return map;
  }, [imports, transactions]);

  const handleConfirmDeleteBatch = async (importId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      setDeletingBatchId(importId);
      const res = await onDeleteImportBatch(importId);
      setConfirmDeleteBatchId(null);
      setStatusMsg(
        `Deleted import batch "${redactImportDisplayText(res.fileName)}" and removed ${res.removedTransactions} linked transaction${
          res.removedTransactions === 1 ? '' : 's'
        } from your local vault.`
      );
    } catch {
      setErrorMsg('Could not delete that import batch.');
    } finally {
      setDeletingBatchId(null);
    }
  };

  const handleSetPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (passphrase.length < 8) {
      setErrorMsg('Use a passphrase of at least 8 characters to derive a strong AES-256 key.');
      return;
    }
    if (passphrase !== confirmPass) {
      setErrorMsg('Passphrases do not match.');
      return;
    }

    try {
      setBusy(true);
      await onEnableEncryption(passphrase);
      setPassphrase('');
      setConfirmPass('');
      setStatusMsg(
        'Vault encrypted locally using AES-256-GCM (PBKDF2-SHA256, 310,000 iterations). Plaintext wiped from IndexedDB.'
      );
    } catch {
      setErrorMsg('Encryption failed in this browser context.');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    if (!isEncrypted && exportPass.length < 8) {
      setErrorMsg('Enter an 8+ character passphrase to encrypt your portable backup file.');
      return;
    }
    try {
      setBusy(true);
      const result = await onExportEncryptedVault(isEncrypted ? undefined : exportPass);
      setStatusMsg(
        result.status === 'saved'
          ? `Encrypted backup saved as ${result.fileName} to your chosen location.`
          : result.status === 'cancelled'
            ? 'Encrypted backup save cancelled; no file was written.'
            : `Encrypted backup download requested for ${result.fileName}; confirm it appears in your Downloads before relying on it.`
      );
    } catch {
      setErrorMsg('Could not save encrypted vault backup. Check the selected location for a partial file before retrying.');
    } finally {
      setExportPass('');
      setBusy(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!selectedImportFile || !importPass) {
      setErrorMsg('Select a .vault.json file and enter its decryption passphrase.');
      return;
    }
    try {
      setBusy(true);
      const msg = await onImportEncryptedVault(selectedImportFile, importPass);
      setStatusMsg(msg);
      setSelectedImportFile(null);
      setImportPass('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Incorrect passphrase or corrupted vault file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Local Vault &amp; Settings
        </h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          100% on-device processing · Optional AI assistant (off by default) · AES-256-GCM local encryption
        </p>
      </div>

      {statusMsg && (
        <div
          role="status"
          className="p-4 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-sm text-teal-900 dark:text-teal-200"
        >
          {statusMsg}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-900 dark:text-red-200"
        >
          {errorMsg}
        </div>
      )}

      {/* AI Financial Assistant Settings (ReadAloud-style calm, off-by-default design) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="space-y-1.5 max-w-3xl">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            AI Financial Assistant
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Savings recommendations, spending explanations, and Cash ISA guidance from your local summary, with Claude, ChatGPT, or Gemini. It is off until you turn it on. The generated summary omits raw statements and merchant names, but your typed question is also sent to the provider. Review it for private details before sending.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
          <div>
            <label
              htmlFor="settings-ai-provider"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Provider
            </label>
            <select
              id="settings-ai-provider"
              value={aiSettings.provider}
              onChange={(e) => {
                const next = e.target.value as AiProviderSetting;
                onUpdateAiProvider(next);
                setStatusMsg(
                  next === 'off'
                    ? 'AI Financial Assistant turned off. No outbound AI calls will be made.'
                    : `AI Financial Assistant set to ${AI_PROVIDER_LABELS[next]}.`
                );
              }}
              className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
            >
              <option value="off">Off</option>
              <option value="claude">Claude (Anthropic)</option>
              <option value="chatgpt">ChatGPT (OpenAI)</option>
              <option value="gemini">Gemini (Google)</option>
            </select>
          </div>

          {aiSettings.provider !== 'off' && (
            <div>
              <label
                htmlFor="settings-ai-retention"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Keep AI enabled
              </label>
              <select
                id="settings-ai-retention"
                value={aiSettings.retention}
                onChange={(e) => {
                  const next = e.target.value as AiRetentionOption;
                  onUpdateAiRetention(next);
                }}
                className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
              >
                {AI_RETENTION_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {aiSettings.provider === 'off' ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            AI advice is currently off. To turn it on, choose a provider above. You can turn it off and forget the session here at any time.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400">
                  Selected Provider &amp; Server Proxy Status
                </span>
                <span
                  className={`font-medium ${
                    providerStatus?.[aiSettings.provider]?.available
                      ? 'text-teal-700 dark:text-teal-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {providerStatus?.[aiSettings.provider]?.available
                    ? `Ready (${providerStatus[aiSettings.provider].model})`
                    : `Configure ${providerStatus?.[aiSettings.provider]?.envVar ?? 'provider secret'} in Settings > Secrets`}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400">
                  Automatic Expiry Window
                </span>
                <span className="font-mono-num text-slate-800 dark:text-slate-200">
                  {formatRemainingRetention(aiSettings.expiresAt)}
                </span>
              </div>
              <p className="pt-1.5 border-t border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 leading-relaxed">
                For web security, credentials stay in your host environment (Settings &gt; Secrets) and are never written into vault backup exports or browser storage.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={aiSettings.ratiosOnly}
                  onChange={(e) => onUpdateAiRatiosOnly(e.target.checked)}
                  className="w-4 h-4 rounded accent-teal-700"
                />
                <span>Mask exact amounts (send ratios &amp; income bands only)</span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onForgetAiSession();
                    setStatusMsg(
                      'AI Financial Assistant turned off and session preferences cleared.'
                    );
                  }}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Forget &amp; Turn Off
                </button>
                <button
                  type="button"
                  onClick={onNavigateAi}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Open AI Advisor</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          Bank statements, category caps, subscriptions, and PDF reports stay on this device. AI preferences are never included in vault or family export files.
        </p>
      </section>

      {/* Privacy Architecture & Passphrase Vault */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                End-to-End Passphrase Protection
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isEncrypted
                  ? 'Your local IndexedDB ledger is encrypted with AES-256-GCM. Only your passphrase can decrypt it.'
                  : 'Set a local master passphrase to encrypt all stored bank statements and goals at rest.'}
              </p>
            </div>
            <ShieldCheck
              className={`w-6 h-6 shrink-0 ${
                isEncrypted ? 'text-teal-700 dark:text-teal-400' : 'text-slate-400'
              }`}
            />
          </div>

          {isEncrypted ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Storage State</span>
                  <span className="font-medium text-teal-700 dark:text-teal-400">
                    Encrypted at Rest (AES-256-GCM)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Key Derivation</span>
                  <span className="font-mono-num text-slate-800 dark:text-slate-200">
                    PBKDF2-SHA256 · {(envelope?.iterations ?? 310000).toLocaleString()} iterations
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Ciphertext Payload</span>
                  <span className="font-mono-num text-slate-800 dark:text-slate-200">
                    {envelope ? `${(envelope.byteLength / 1024).toFixed(1)} KB` : 'Sealed'}
                  </span>
                </div>
                {envelope && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <p className="text-slate-500 dark:text-slate-400 mb-1">
                      Live IndexedDB Ciphertext Preview (Base64):
                    </p>
                    <p className="font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800">
                      iv={envelope.ivBase64} · salt={envelope.saltBase64.slice(0, 12)}… · data=
                      {envelope.ciphertextBase64.slice(0, 96)}…
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onLockVaultNow}
                  className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Lock Vault Now
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onDisableEncryption();
                    setStatusMsg('Passphrase lock removed. Data remains strictly local on this device.');
                  }}
                  className="min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Remove Passphrase Lock
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSetPassphrase} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-passphrase"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Master Passphrase (min. 8 chars)
                  </label>
                  <input
                    id="new-passphrase"
                    type="password"
                    required
                    minLength={8}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter a strong passphrase"
                    className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="confirm-passphrase"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Confirm Passphrase
                  </label>
                  <input
                    id="confirm-passphrase"
                    type="password"
                    required
                    minLength={8}
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    placeholder="Repeat passphrase"
                    className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <KeyRound className="w-4 h-4" />
                {busy ? 'Deriving AES-256 Key…' : 'Encrypt Local Vault'}
              </button>
            </form>
          )}

          {/* Zero-Cloud Verification Facts */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">Zero Cloud Upload</p>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                CSV/OFX parsing and categorization execute locally in memory. No bank data is transmitted over the network.
              </p>
            </div>
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">Authenticated Cipher</p>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                Web Crypto AES-256-GCM detects tampering automatically and generates a fresh random 96-bit IV on every save.
              </p>
            </div>
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">No Open Banking Risk</p>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                You never share bank logins, API tokens, or credentials with any third-party aggregator.
              </p>
            </div>
          </div>
        </section>

        {/* Cross-Device Encrypted Transfer (Windows <-> Mobile) */}
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Offline Windows ↔ Mobile Sync
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Transfer an AES-256 encrypted backup file directly between your Windows desktop and mobile device without cloud servers
            </p>
          </div>

          <div className="space-y-3">
            {!isEncrypted && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Passphrase for Encrypted Export
                </label>
                <input
                  type="password"
                  value={exportPass}
                  onChange={(e) => setExportPass(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
            )}
            <button
              type="button"
              onClick={handleExport}
              disabled={busy}
              className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Export Encrypted .vault.json Backup
            </button>
          </div>

          <form onSubmit={handleImport} className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Restore Encrypted Vault File
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.vault"
              onChange={(e) => setSelectedImportFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-600 dark:text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-800 dark:file:text-slate-200 hover:file:bg-slate-200 dark:hover:file:bg-slate-700 cursor-pointer"
            />
            <input
              type="password"
              value={importPass}
              onChange={(e) => setImportPass(e.target.value)}
              placeholder="Vault decryption passphrase"
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={busy || !selectedImportFile}
              className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium disabled:opacity-40 transition-opacity cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Decrypt &amp; Restore Vault
            </button>
          </form>
        </section>
      </div>

      {/* Statement Import History Log */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
              <History className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              Import History
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Chronological log of all imported bank statement batches ·{' '}
              <span className="font-mono-num text-slate-700 dark:text-slate-300">
                {imports.length} batch{imports.length === 1 ? '' : 'es'}
              </span>{' '}
              ·{' '}
              <span className="font-mono-num text-slate-700 dark:text-slate-300">
                {transactionCount} active ledger rows
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {imports.length > 1 && (
              <div
                className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
                role="group"
                aria-label="Sort import history chronologically"
              >
                <button
                  type="button"
                  onClick={() => setImportSortOrder('newest')}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    importSortOrder === 'newest'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Newest First
                </button>
                <button
                  type="button"
                  onClick={() => setImportSortOrder('oldest')}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    importSortOrder === 'oldest'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Oldest First
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onOpenImport}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Statements
            </button>
          </div>
        </div>

        {sortedImports.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No statement batches recorded in this vault yet
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Upload CSV, OFX, QFX, or a folder of bank statements to track and manage each batch here.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Chronological Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-5">Statement File</th>
                    <th className="py-3 px-4 w-44">Imported</th>
                    <th className="py-3 px-4 w-32 text-right">Rows</th>
                    <th className="py-3 px-4 w-52">Date Range</th>
                    <th className="py-3 px-5 w-48 text-right">Batch Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                  {sortedImports.map((imp) => {
                    const liveRows = activeRowsByBatchId.get(imp.id) ?? 0;
                    const isConfirming = confirmDeleteBatchId === imp.id;
                    const isDeleting = deletingBatchId === imp.id;

                    return (
                      <tr
                        key={imp.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-5">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <FileSpreadsheet className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 break-all">
                                {redactImportDisplayText(imp.fileName)}
                              </p>
                              {imp.duplicatesSkipped > 0 && (
                                <p className="mt-0.5 text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                                  {imp.duplicatesSkipped} duplicate
                                  {imp.duplicatesSkipped === 1 ? '' : 's'} skipped on import
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono-num text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {formatImportTimestamp(imp.importedAt)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num whitespace-nowrap">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {imp.rowCount.toLocaleString()}
                          </p>
                          {liveRows !== imp.rowCount && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {liveRows.toLocaleString()} in ledger
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {imp.dateRangeStart && imp.dateRangeEnd
                            ? `${imp.dateRangeStart} → ${imp.dateRangeEnd}`
                            : '—'}
                        </td>
                        <td className="py-3 px-5 text-right whitespace-nowrap">
                          {!isConfirming ? (
                            <button
                              type="button"
                              disabled={Boolean(deletingBatchId)}
                              onClick={() => setConfirmDeleteBatchId(imp.id)}
                              className="min-h-[34px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-red-300 dark:hover:border-red-800 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50/60 dark:hover:bg-red-950/30 disabled:opacity-40 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete Batch
                            </button>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-2">
                              <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => void handleConfirmDeleteBatch(imp.id)}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium transition-colors cursor-pointer"
                              >
                                {isDeleting
                                  ? 'Deleting…'
                                  : `Confirm (${liveRows} row${liveRows === 1 ? '' : 's'})`}
                              </button>
                              <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => setConfirmDeleteBatchId(null)}
                                className="min-h-[34px] px-2 py-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Chronological Cards */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
              {sortedImports.map((imp) => {
                const liveRows = activeRowsByBatchId.get(imp.id) ?? 0;
                const isConfirming = confirmDeleteBatchId === imp.id;
                const isDeleting = deletingBatchId === imp.id;

                return (
                  <div key={imp.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 break-all">
                          {redactImportDisplayText(imp.fileName)}
                        </p>
                        <p className="mt-0.5 text-xs font-mono-num text-slate-500 dark:text-slate-400">
                          Imported {formatImportTimestamp(imp.importedAt)}
                        </p>
                      </div>
                      <span className="text-xs font-mono-num font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                        {imp.rowCount.toLocaleString()} rows
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <span className="font-mono-num">
                        {imp.dateRangeStart && imp.dateRangeEnd
                          ? `${imp.dateRangeStart} → ${imp.dateRangeEnd}`
                          : 'No date range'}
                      </span>
                      {imp.duplicatesSkipped > 0 && (
                        <span className="font-mono-num text-[11px] text-slate-500">
                          {imp.duplicatesSkipped} dupes skipped
                        </span>
                      )}
                    </div>

                    <div className="pt-1 flex items-center justify-end gap-2">
                      {!isConfirming ? (
                        <button
                          type="button"
                          disabled={Boolean(deletingBatchId)}
                          onClick={() => setConfirmDeleteBatchId(imp.id)}
                          className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete Batch
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => void handleConfirmDeleteBatch(imp.id)}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium cursor-pointer"
                          >
                            {isDeleting ? 'Deleting…' : `Delete (${liveRows} rows)`}
                          </button>
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => setConfirmDeleteBatchId(null)}
                            className="min-h-[36px] px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Preferences & Local Data Controls */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-4">
          Workspace Preferences &amp; Data Management
        </h2>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <div className="py-4 first:pt-0 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Primary Display Currency
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mixed-currency transactions convert automatically into this currency using your offline table below. GBP (£) includes UK £20,000 ISA and £4,000 LISA caps.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start lg:self-auto">
                {(Object.keys(CURRENCY_CONFIG) as CurrencyCode[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => onCurrencyChange(code)}
                    className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      currency === code
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {CURRENCY_CONFIG[code].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Internal Offline Exchange Rate Table */}
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Internal Exchange Rate Table (100% Offline)
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Rates stored as units per 1 GBP inside your encrypted local vault · Zero external FX API calls
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateExchangeRates({ ...DEFAULT_EXCHANGE_RATES });
                    setStatusMsg('Restored default internal exchange rates.');
                  }}
                  className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset Defaults
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {(Object.keys(CURRENCY_CONFIG) as CurrencyCode[]).map((code) => {
                  const effectiveRate =
                    exchangeRates?.[code] ?? DEFAULT_EXCHANGE_RATES[code];
                  const oneUnitInPrimary = convertAmount(
                    1,
                    code,
                    currency,
                    exchangeRates
                  );
                  const isBasePivot = code === 'GBP';
                  return (
                    <div
                      key={code}
                      className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-1.5"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {code}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {CURRENCY_CONFIG[code].name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono-num text-slate-400 shrink-0">
                          1 GBP =
                        </span>
                        <input
                          type="number"
                          aria-label={`Exchange rate for ${code} per 1 GBP`}
                          disabled={isBasePivot}
                          min="0.0001"
                          step="0.01"
                          value={effectiveRate}
                          onChange={(e) => {
                            const nextVal = parseFloat(e.target.value);
                            if (Number.isFinite(nextVal) && nextVal > 0) {
                              onUpdateExchangeRates({
                                ...DEFAULT_EXCHANGE_RATES,
                                ...(exchangeRates ?? {}),
                                [code]: nextVal,
                              });
                            }
                          }}
                          className="w-full min-h-[32px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono-num text-right text-slate-900 dark:text-slate-100 disabled:opacity-60"
                        />
                      </div>
                      <p className="text-[10px] font-mono-num text-slate-500 dark:text-slate-400">
                        {code === currency
                          ? 'Primary display currency'
                          : `1 ${code} ≈ ${formatMoney(oneUnitInPrimary, currency, currency === 'JPY' ? 0 : 2)}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Appearance
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Switch between daylight slate and low-glare dark mode
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleDarkMode}
              className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 self-start sm:self-auto cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            </button>
          </div>

          <div className="py-4 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Local Ledger Storage ({transactionCount} rows · {isSampleData ? 'Sample' : 'Custom'})
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Fictional sample data is optional. Loading it replaces the current ledger; shredding removes all local records.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!confirmSample ? (
                <button
                  type="button"
                  onClick={() => setConfirmSample(true)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Load Fictional Sample
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-amber-700 dark:text-amber-300">This replaces your current ledger and settings.</span>
                  <button type="button" onClick={() => setConfirmSample(false)} className="px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-700">Cancel</button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onResetSampleData();
                      setConfirmSample(false);
                      setStatusMsg('Loaded fictional 14-month sample data.');
                    }}
                    className="px-2 py-2 rounded-lg border border-amber-500 text-amber-800 dark:text-amber-300"
                  >
                    Replace with Sample
                  </button>
                </div>
              )}

              {!confirmShred ? (
                <button
                  type="button"
                  onClick={() => setConfirmShred(true)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Shred Local Data
                </button>
              ) : (
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await onShredAllData();
                      setConfirmShred(false);
                      setStatusMsg('All local transactions and keys permanently wiped from this device.');
                    }}
                    className="min-h-[40px] px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Confirm Permanent Wipe
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmShred(false)}
                    className="min-h-[40px] px-3 py-2 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
