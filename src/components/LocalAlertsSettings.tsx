import React, { useMemo, useState } from 'react';
import { Bell, Plus, Trash2 } from 'lucide-react';
import {
  CATEGORIES,
  formatMoney,
  type CategoryId,
  type CurrencyCode,
  type LocalAlertRule,
} from '../types/finance';
import { normalizeLocalAlertRules, type LocalAlertMatch } from '../utils/localAlerts';
import { localAlertPlatform } from '../utils/localAlertDelivery';

interface Props {
  rules: LocalAlertRule[];
  matches: LocalAlertMatch[];
  categoryCaps: Partial<Record<CategoryId, number>>;
  currency: CurrencyCode;
  isSampleData: boolean;
  osEnabled: boolean;
  onUpdateRules: (rules: LocalAlertRule[]) => Promise<boolean>;
  onEnableOs: () => Promise<boolean>;
  onDisableOs: () => Promise<void>;
  onTestOs: () => Promise<boolean>;
}

const spendingCategories = Object.values(CATEGORIES).filter((item) =>
  item.defaultClass !== 'income' && item.defaultClass !== 'savings'
);

function describeRule(rule: LocalAlertRule, currency: CurrencyCode): string {
  if (rule.kind === 'category_spend') {
    return `${CATEGORIES[rule.categoryId].label}: monthly net spend reaches ${formatMoney(rule.threshold, rule.thresholdCurrency, 2)}`;
  }
  if (rule.kind === 'projected_cap') {
    return `${CATEGORIES[rule.categoryId].label}: projected monthly cap exceeded`;
  }
  return `${rule.label || 'Local reminder'} · ${new Date(rule.at).toLocaleString('en-GB')}`;
}

export const LocalAlertsSettings: React.FC<Props> = ({
  rules, matches, categoryCaps, currency, isSampleData, osEnabled,
  onUpdateRules, onEnableOs, onDisableOs, onTestOs,
}) => {
  const [kind, setKind] = useState<LocalAlertRule['kind']>('category_spend');
  const [categoryId, setCategoryId] = useState<CategoryId>('groceries');
  const [threshold, setThreshold] = useState('100');
  const [at, setAt] = useState('');
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const cleanRules = useMemo(() => normalizeLocalAlertRules(rules), [rules]);
  const matchByRule = useMemo(() => new Map(matches.map((match) => [match.ruleId, match])), [matches]);
  const platform = localAlertPlatform();

  const update = async (next: LocalAlertRule[], success: string): Promise<boolean> => {
    setBusy(true);
    setStatus('');
    try {
      const osSynced = await onUpdateRules(next);
      setStatus(osSynced ? success : 'Rule saved locally, but Android reminder scheduling/cancellation was not confirmed. Clearledger will retry on app focus or reopen; an old generic reminder may still appear.');
      return true;
    } catch {
      setStatus('Could not save the alert rule to your local vault. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (cleanRules.length >= 32) { setStatus('The 32-rule limit has been reached.'); return; }
    const id = crypto.randomUUID().replace(/-/g, '');
    const common = { id, enabled: true, createdAt: new Date().toISOString() };
    let next: LocalAlertRule;
    if (kind === 'category_spend') {
      const amount = Number(threshold);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
        setStatus('Enter a positive monthly threshold.'); return;
      }
      next = { ...common, kind, categoryId, threshold: amount, thresholdCurrency: currency };
    } else if (kind === 'projected_cap') {
      if (!Number.isFinite(categoryCaps[categoryId]) || (categoryCaps[categoryId] ?? 0) <= 0) {
        setStatus('Set this category’s monthly cap on Overview before adding a cap alert.'); return;
      }
      next = { ...common, kind, categoryId };
    } else {
      if (!at || new Date(at).getTime() <= Date.now() || label.trim().length > 80) {
        setStatus('Choose a future local date/time and a label of at most 80 characters.'); return;
      }
      next = { ...common, kind, at, ...(label.trim() ? { label: label.trim() } : {}) };
    }
    const normalized = normalizeLocalAlertRules([next]);
    if (normalized.length !== 1) { setStatus('This rule could not be validated.'); return; }
    const saved = await update([...cleanRules, normalized[0]], 'Rule saved locally. It will be checked on app open and after imports.');
    if (saved && kind === 'date_reminder') { setAt(''); setLabel(''); }
  };

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5" aria-labelledby="local-alerts-heading">
      <div>
        <h2 id="local-alerts-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
          <Bell className="w-4 h-4 text-teal-700 dark:text-teal-400" /> Local alerts &amp; reminders
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Make your own monthly spending triggers or a one-time date reminder. Rules stay in this local vault and are included in encrypted vault backups.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
        Clearledger has no live bank feed. Spending rules recalculate only while the app is open, including after a statement import; they cannot update from new transactions while closed. Android date reminders can fire while closed if the OS permits, but delivery may be delayed. Windows reminders require the app to be open. Notifications never show amounts, categories, merchants, account names, or your private reminder label.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || platform === 'none'}
          onClick={async () => {
            setBusy(true);
            try { setStatus(await onEnableOs() ? 'Notification opt-in saved. Send a generic test to confirm this device displays it.' : 'Notification permission or support is unavailable. In-app alerts still work.'); }
            catch { setStatus('Could not enable OS notifications. In-app alerts still work.'); }
            finally { setBusy(false); }
          }}
          className="min-h-10 rounded-lg bg-teal-700 px-4 text-sm font-medium text-white disabled:opacity-50 cursor-pointer">
          {osEnabled ? 'Check notification permission' : 'Enable device notifications'}
        </button>
        {osEnabled && <>
          <button type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            try { setStatus(await onTestOs() ? 'Generic test notification requested.' : 'The device did not display a notification. Check OS settings.'); }
            catch { setStatus('The test notification failed. Check OS settings.'); }
            finally { setBusy(false); }
          }} className="min-h-10 rounded-lg border border-slate-300 dark:border-slate-700 px-4 text-sm cursor-pointer">Send generic test</button>
          <button type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await onDisableOs(); setStatus('OS notifications turned off. Rules remain in your vault.'); }
            catch { setStatus('Device opt-out or pending-reminder cancellation was not confirmed. Clearledger will retry while open; disable Clearledger notifications in Android/Windows system settings if necessary.'); }
            finally { setBusy(false); }
          }} className="min-h-10 rounded-lg border border-slate-300 dark:border-slate-700 px-4 text-sm cursor-pointer">Turn off device notifications</button>
        </>}
        <span className="text-xs text-slate-500 dark:text-slate-400">{platform === 'none' ? 'Browser preview: in-app checks only' : osEnabled ? 'Opted in; OS delivery depends on device settings' : 'Off by default'}</span>
      </div>

      <form onSubmit={(event) => { void add(event); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Trigger
          <select value={kind} onChange={(event) => setKind(event.target.value as LocalAlertRule['kind'])} className="mt-1 block w-full min-h-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm">
            <option value="category_spend">Monthly category spend</option>
            <option value="projected_cap">Projected monthly cap</option>
            <option value="date_reminder">One-time date reminder</option>
          </select>
        </label>
        {kind !== 'date_reminder' ? <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Category
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value as CategoryId)} className="mt-1 block w-full min-h-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm">
            {spendingCategories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label> : <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Reminder label (private, optional)
          <input type="text" maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="What to review" className="mt-1 block w-full min-h-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm" />
        </label>}
        {kind === 'category_spend' ? <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Monthly threshold ({currency})
          <input type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01" required value={threshold} onChange={(event) => setThreshold(event.target.value)} className="mt-1 block w-full min-h-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm" />
        </label> : kind === 'date_reminder' ? <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Local date and time
          <input type="datetime-local" required value={at} onChange={(event) => setAt(event.target.value)} className="mt-1 block w-full min-h-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm" />
        </label> : <p className="self-center text-xs text-slate-500 dark:text-slate-400">Uses the cap set on Overview; alerts on current-month imported-statement pace.</p>}
        <button type="submit" disabled={busy || cleanRules.length >= 32} className="min-h-10 rounded-lg bg-teal-700 px-4 text-sm font-medium text-white disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Add local rule</button>
      </form>

      {isSampleData && <p className="text-xs text-amber-700 dark:text-amber-300">Sample ledger: spending matches shown here are synthetic and will not generate OS notifications. Date reminders and explicit test notifications can still be scheduled.</p>}

      {cleanRules.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No rules yet. Nothing will notify you until you add a rule and opt in on this device.</p> :
        <ul className="space-y-2" aria-label="Saved local alert rules">{cleanRules.map((rule) => {
          const match = matchByRule.get(rule.id);
          return <li key={rule.id} className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 sm:w-auto">
              <input type="checkbox" checked={rule.enabled} disabled={busy} onChange={(event) => { void update(cleanRules.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item), event.target.checked ? 'Rule enabled.' : 'Rule paused.'); }} /> Enabled
            </label>
            <div className="min-w-0 w-full sm:w-auto sm:flex-1 text-sm text-slate-800 dark:text-slate-200">
              <p>{describeRule(rule, currency)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{!rule.enabled ? 'Paused' : match ? `Active now · ${match.detail}` : rule.kind === 'date_reminder' ? 'Future reminder; Android can schedule it after opt-in.' : 'No current match in imported statements.'}</p>
            </div>
            <button type="button" disabled={busy} onClick={() => setStatus(match ? `${match.title}. ${match.detail}` : 'This rule has no current match. Future Android reminders are scheduled only after device opt-in and OS permission.')}
              className="min-h-9 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs cursor-pointer">Check now</button>
            <button type="button" disabled={busy} aria-label={`Delete ${describeRule(rule, currency)}`} onClick={() => { void update(cleanRules.filter((item) => item.id !== rule.id), 'Rule deleted.'); }}
              className="min-h-9 rounded-lg border border-red-300 dark:border-red-800 px-3 text-red-700 dark:text-red-300 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
          </li>;
        })}</ul>}
      {status && <p role="status" className="text-sm text-teal-800 dark:text-teal-300">{status}</p>}
      <p className="text-xs text-slate-500 dark:text-slate-400">An OS alert is requested at most once per rule per month. Toggling a rule off and on does not re-arm it; delete and recreate the rule to start a new alert cycle. The next calendar month re-arms monthly triggers. A one-time reminder runs once.</p>
    </section>
  );
};
