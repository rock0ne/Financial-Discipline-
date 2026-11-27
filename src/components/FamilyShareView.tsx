import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Lock,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  formatMoney,
  type CurrencyCode,
  type IsaPlannerSettings,
  type SavingsGoal,
  type Transaction,
} from '../types/finance';
import type { AnalyticsResult } from '../utils/analyticsEngine';
import {
  createEncryptedFamilyShare,
  decryptFamilyShareEnvelope,
  getOrCreateDeviceIdentity,
  isFamilyShareEnvelope,
  loadFamilyContacts,
  parseFamilyShareCode,
  saveFamilyContacts,
  type DeviceIdentityRecord,
  type FamilyContact,
  type FamilyShareEnvelope,
  type FamilySharePayload,
  type FamilyShareScope,
} from '../utils/familyCrypto';

interface FamilyShareViewProps {
  analytics: AnalyticsResult;
  currency: CurrencyCode;
  goals: SavingsGoal[];
  isaSettings: IsaPlannerSettings;
  transactions: Transaction[];
  onMergeSharedTransactions: (txs: Transaction[], senderName: string) => Promise<{ added: number; skipped: number }>;
}

export const FamilyShareView: React.FC<FamilyShareViewProps> = ({
  analytics,
  currency,
  goals,
  isaSettings,
  transactions,
  onMergeSharedTransactions,
}) => {
  const [identity, setIdentity] = useState<DeviceIdentityRecord | null>(null);
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [copiedCode, setCopiedCode] = useState(false);

  // Add family contact form
  const [contactName, setContactName] = useState('');
  const [contactCode, setContactCode] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);

  // Create share file form
  const [senderName, setSenderName] = useState('My Household Vault');
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>('self_test');
  const [shareScope, setShareScope] = useState<FamilyShareScope>('summary_and_goals');
  const [shareNote, setShareNote] = useState('');
  const [sharePin, setSharePin] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  // Receive / Decrypt share file state
  const [pendingEnvelope, setPendingEnvelope] = useState<FamilyShareEnvelope | null>(null);
  const [decryptPin, setDecryptPin] = useState('');
  const [decryptBusy, setDecryptBusy] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [decryptedShare, setDecryptedShare] = useState<FamilySharePayload | null>(null);
  const [mergeFeedback, setMergeFeedback] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const receiveInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [idRec, savedContacts] = await Promise.all([
        getOrCreateDeviceIdentity(),
        loadFamilyContacts(),
      ]);
      if (!mounted) return;
      setIdentity(idRec);
      setContacts(savedContacts);
      if (savedContacts.length > 0) {
        setSelectedRecipientId(savedContacts[0].id);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleCopyShareCode = async () => {
    if (!identity) return;
    try {
      await navigator.clipboard.writeText(identity.shareCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactError(null);
    if (!contactName.trim() || !contactCode.trim()) return;

    try {
      const { fingerprint } = await parseFamilyShareCode(contactCode);
      if (contacts.some((c) => c.fingerprint === fingerprint)) {
        setContactError('This family member device is already saved in your trusted list.');
        return;
      }
      const next: FamilyContact = {
        id: `fam-${Date.now()}`,
        name: contactName.trim(),
        shareCode: contactCode.trim(),
        fingerprint,
        addedAt: new Date().toISOString(),
      };
      const updated = [...contacts, next];
      setContacts(updated);
      await saveFamilyContacts(updated);
      setSelectedRecipientId(next.id);
      setContactName('');
      setContactCode('');
    } catch (err) {
      setContactError(err instanceof Error ? err.message : 'Invalid Family Share Code.');
    }
  };

  const handleRemoveContact = async (id: string) => {
    const updated = contacts.filter((c) => c.id !== id);
    setContacts(updated);
    await saveFamilyContacts(updated);
    if (selectedRecipientId === id) {
      setSelectedRecipientId(updated[0]?.id ?? 'self_test');
    }
  };

  const handleGenerateShareFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identity) return;
    setShareError(null);
    setShareStatus(null);

    const targetCode =
      selectedRecipientId === 'self_test'
        ? identity.shareCode
        : contacts.find((c) => c.id === selectedRecipientId)?.shareCode;

    const targetLabel =
      selectedRecipientId === 'self_test'
        ? 'This Device (Self-Test)'
        : contacts.find((c) => c.id === selectedRecipientId)?.name ?? 'Family Member';

    if (!targetCode) {
      setShareError('Select a trusted family member or add their Clearledger Share Code first.');
      return;
    }

    try {
      setShareBusy(true);
      const envelope = await createEncryptedFamilyShare({
        senderIdentity: identity,
        senderName,
        recipientShareCode: targetCode,
        scope: shareScope,
        note: shareNote,
        pin: sharePin,
        currency,
        analytics,
        goals,
        isaSettings,
        transactions,
      });

      const blob = new Blob([JSON.stringify(envelope, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const safeTarget = targetLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const a = document.createElement('a');
      a.href = url;
      a.download = `clearledger_for_${safeTarget}_${new Date().toISOString().slice(0, 10)}.clearledger-share.json`;
      a.click();
      URL.revokeObjectURL(url);

      setShareStatus(
        `Encrypted file created exclusively for ${targetLabel} (Device ${envelope.recipientFingerprint}). Only their Clearledger app can decrypt it.`
      );
      setSharePin('');
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Could not create encrypted family share.');
    } finally {
      setShareBusy(false);
    }
  };

  const handleReceiveFileSelect = async (file: File) => {
    setDecryptError(null);
    setDecryptedShare(null);
    setMergeFeedback(null);
    setPendingEnvelope(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!isFamilyShareEnvelope(parsed)) {
        setDecryptError('This file is not a valid Clearledger encrypted family share (.clearledger-share.json).');
        return;
      }

      setPendingEnvelope(parsed);

      // If no PIN is required and fingerprint matches, decrypt immediately
      if (!parsed.pinProtected && identity) {
        setDecryptBusy(true);
        const decrypted = await decryptFamilyShareEnvelope(parsed, identity);
        setDecryptedShare(decrypted);
        setPendingEnvelope(null);
      }
    } catch (err) {
      setDecryptError(err instanceof Error ? err.message : 'Unable to read or decrypt this family share file.');
    } finally {
      setDecryptBusy(false);
      if (receiveInputRef.current) receiveInputRef.current.value = '';
    }
  };

  const handleDecryptWithPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingEnvelope || !identity) return;
    setDecryptError(null);
    try {
      setDecryptBusy(true);
      const decrypted = await decryptFamilyShareEnvelope(pendingEnvelope, identity, decryptPin);
      setDecryptedShare(decrypted);
      setPendingEnvelope(null);
      setDecryptPin('');
    } catch (err) {
      setDecryptError(err instanceof Error ? err.message : 'Incorrect Family PIN or mismatched device key.');
    } finally {
      setDecryptBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Encrypted Family Sharing
        </h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          App-bound public-key encryption (ECDH P-256 + AES-256-GCM) · Shared files can only be decrypted inside the intended family member&apos;s Clearledger app
        </p>
      </div>

      {/* Step 1: Device Cryptographic Identity */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Your App&apos;s Family Share Code
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
              Give this public Share Code to a family member so they can lock a shared file specifically to your Clearledger installation. Your private decryption key is non-extractable and never leaves this device.
            </p>
          </div>

          {identity && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
              <div className="px-3.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Device Fingerprint: </span>
                <strong className="font-mono-num text-slate-900 dark:text-slate-100">
                  {identity.fingerprint}
                </strong>
              </div>
              <button
                type="button"
                onClick={handleCopyShareCode}
                className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCode ? 'Share Code Copied' : 'Copy My Share Code'}
              </button>
            </div>
          )}
        </div>

        {identity && (
          <div className="mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all select-all">
            {identity.shareCode}
          </div>
        )}
      </section>

      {/* Two-Column Core Flow: Send Encrypted Share vs Receive & Decrypt */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Send to Family Member */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              1. Create Encrypted Family File
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Lock your household summary or ledger to a specific family member&apos;s app key
            </p>
          </div>

          {/* Trusted Family Contacts Mini-Manager */}
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
              Add Family Member&apos;s Share Code
            </p>
            <form onSubmit={handleAddContact} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Name (e.g. Partner Phone)"
                className="sm:col-span-4 min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
              />
              <input
                type="text"
                value={contactCode}
                onChange={(e) => setContactCode(e.target.value)}
                placeholder="Paste their CLF1-... code"
                className="sm:col-span-6 min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                className="sm:col-span-2 min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium cursor-pointer"
              >
                Add
              </button>
            </form>
            {contactError && <p className="text-xs text-red-600 dark:text-red-400">{contactError}</p>}

            {contacts.length > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 divide-y divide-slate-200/70 dark:divide-slate-800">
                {contacts.map((c) => (
                  <div key={c.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{c.name}</span>
                      <span className="ml-2 font-mono-num text-slate-500">ID {c.fingerprint}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemoveContact(c.id)}
                      aria-label={`Remove ${c.name}`}
                      className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleGenerateShareFile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Recipient Clearledger App
                </label>
                <select
                  value={selectedRecipientId}
                  onChange={(e) => setSelectedRecipientId(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                >
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.fingerprint})
                    </option>
                  ))}
                  <option value="self_test">
                    This Device ({identity?.fingerprint ?? 'Local'}) — Self-Test
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Your Display Name
                </label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                What to Include in Shared File
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShareScope('summary_and_goals')}
                  className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                    shareScope === 'summary_and_goals'
                      ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/30'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Summary &amp; Goals Only
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Category averages, Essential split, Cash ISA plan. No individual rows.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setShareScope('full_household_ledger')}
                  className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                    shareScope === 'full_household_ledger'
                      ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/30'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Full Household Ledger
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Includes all {transactions.length} transactions so family can merge budgets.
                  </p>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Optional Family PIN (2nd Factor)
                </label>
                <input
                  type="password"
                  value={sharePin}
                  onChange={(e) => setSharePin(e.target.value)}
                  placeholder="Optional extra PIN"
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Note for Family Member
                </label>
                <input
                  type="text"
                  value={shareNote}
                  onChange={(e) => setShareNote(e.target.value)}
                  placeholder="e.g. Nov 2026 Cash ISA review"
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {shareError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {shareError}
              </p>
            )}
            {shareStatus && (
              <p role="status" className="text-xs text-teal-700 dark:text-teal-400">
                {shareStatus}
              </p>
            )}

            <button
              type="submit"
              disabled={shareBusy || !identity}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              {shareBusy ? 'Encrypting with ECDH P-256…' : 'Encrypt & Download Family Share File'}
            </button>
          </form>
        </section>

        {/* Right: Upload & Decrypt Received Family Share */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              2. Open Received Family File
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Upload a .clearledger-share.json file sent to you. Decryption succeeds only if it was locked to your app&apos;s private key.
            </p>
          </div>

          <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 p-6 text-center">
            <Lock className="w-6 h-6 text-teal-700 dark:text-teal-400 mx-auto" />
            <p className="mt-2.5 text-sm font-medium text-slate-900 dark:text-slate-100">
              Upload an encrypted family share file
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Safe to receive via email, WhatsApp, AirDrop, or USB drive—ciphertext cannot be opened outside Clearledger
            </p>
            <input
              ref={receiveInputRef}
              type="file"
              accept=".json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleReceiveFileSelect(file);
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => receiveInputRef.current?.click()}
              className="mt-4 min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Select .clearledger-share.json
            </button>
          </div>

          {pendingEnvelope && pendingEnvelope.pinProtected && (
            <form
              onSubmit={handleDecryptWithPin}
              className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                File from {pendingEnvelope.senderName} requires its Family PIN
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  required
                  value={decryptPin}
                  onChange={(e) => setDecryptPin(e.target.value)}
                  placeholder="Enter shared Family PIN"
                  className="flex-1 min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={decryptBusy}
                  className="min-h-[40px] px-4 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium cursor-pointer"
                >
                  {decryptBusy ? 'Decrypting…' : 'Decrypt'}
                </button>
              </div>
            </form>
          )}

          {decryptError && (
            <div
              role="alert"
              className="p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-900 dark:text-red-200 leading-relaxed"
            >
              {decryptError}
            </div>
          )}

          {/* Decrypted Family Snapshot Viewer */}
          {decryptedShare && (
            <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-950/20 p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-teal-800 dark:text-teal-300 inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    Verified &amp; Decrypted Locally
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                    {decryptedShare.senderName}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {decryptedShare.summary.monthCount} months ({decryptedShare.summary.dateRangeLabel}) · Sender ID {decryptedShare.senderFingerprint}
                  </p>
                </div>
                <Users className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
              </div>

              {decryptedShare.note && (
                <p className="text-xs text-slate-700 dark:text-slate-300 italic">
                  &ldquo;{decryptedShare.note}&rdquo;
                </p>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-teal-200/70 dark:border-teal-900/60 text-xs">
                <div>
                  <p className="text-slate-500 dark:text-slate-400">Monthly Income</p>
                  <p className="font-mono-num text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatMoney(decryptedShare.summary.avgMonthlyIncome, decryptedShare.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 dark:text-slate-400">Savings Rate</p>
                  <p className="font-mono-num text-sm font-semibold text-teal-700 dark:text-teal-400">
                    {decryptedShare.summary.savingsRatePct}%
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 dark:text-slate-400">Essential / mo</p>
                  <p className="font-mono-num text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatMoney(decryptedShare.summary.avgMonthlyEssential, decryptedShare.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 dark:text-slate-400">Non-Essential / mo</p>
                  <p className="font-mono-num text-sm font-semibold text-amber-700 dark:text-amber-400">
                    {formatMoney(decryptedShare.summary.avgMonthlyNonEssential, decryptedShare.currency)}
                  </p>
                </div>
              </div>

              {decryptedShare.goals.length > 0 && (
                <div className="pt-2 border-t border-teal-200/70 dark:border-teal-900/60 space-y-1.5">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Shared Goals ({decryptedShare.goals.length})
                  </p>
                  {decryptedShare.goals.map((g) => (
                    <div key={g.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-700 dark:text-slate-300 truncate">{g.name}</span>
                      <span className="font-mono-num text-slate-600 dark:text-slate-400 shrink-0">
                        {formatMoney(g.currentSaved, decryptedShare.currency)} /{' '}
                        {formatMoney(g.targetAmount, decryptedShare.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {decryptedShare.transactions && decryptedShare.transactions.length > 0 && (
                <div className="pt-3 border-t border-teal-200/70 dark:border-teal-900/60 space-y-2">
                  <button
                    type="button"
                    disabled={mergeBusy}
                    onClick={() => {
                      if (mergeBusy) return;
                      setMergeBusy(true);
                      setMergeFeedback(null);
                      void onMergeSharedTransactions(
                        decryptedShare.transactions!,
                        decryptedShare.senderName
                      ).then((res) => {
                        setMergeFeedback(
                          `Saved ${res.added} household transactions into your local ledger (${res.skipped} duplicates skipped).`
                        );
                      }).catch(() => {
                        setMergeFeedback('Local vault save failed or is unconfirmed. Shared rows remain available; check vault status before retrying.');
                      }).finally(() => {
                        setMergeBusy(false);
                      });
                    }}
                    className="w-full min-h-[40px] px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-medium transition-colors cursor-pointer"
                  >
                    {mergeBusy ? 'Saving shared transactions…' : `Merge ${decryptedShare.transactions.length} Shared Transactions into My Household Ledger`}
                  </button>
                  {mergeFeedback && (
                    <p className="text-xs font-medium text-teal-800 dark:text-teal-300">
                      {mergeFeedback}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Cryptographic Guarantee Details */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
            <p className="font-medium text-slate-700 dark:text-slate-300">
              How app-exclusive family decryption works:
            </p>
            <p>
              Every Clearledger installation creates a hardware/IndexedDB-bound non-extractable ECDH P-256 keypair. When you share a file, Clearledger encrypts it using an ephemeral key paired exclusively with your family member&apos;s public Share Code, bound with HKDF-SHA256 domain separation and authenticated AES-256-GCM headers.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};
