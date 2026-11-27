import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  CreditCard,
  FileText,
  HelpCircle,
  LayoutDashboard,
  ListFilter,
  Lock,
  Moon,
  NotebookPen,
  PiggyBank,
  Redo2,
  Repeat,
  Scissors,
  Shield,
  Sparkles,
  Sun,
  Undo2,
  Upload,
  Users,
} from 'lucide-react';
import {
  CATEGORIES,
  DEFAULT_EXCHANGE_RATES,
  convertAmount,
  type AdvancedAutomationRule,
  type AiAssistantSettings,
  type AiProviderSetting,
  type AiRetentionOption,
  type CategoryId,
  type CategoryRule,
  type CategoryRuleSuggestion,
  type CurrencyCode,
  type DebtAccount,
  type EncryptedVaultEnvelope,
  type ExchangeRateTable,
  type IsaPlannerSettings,
  type PersonalPlannerState,
  type SavingsGoal,
  type StatementImportMeta,
  type SubscriptionClass,
  type Transaction,
  type VaultPayload,
} from './types/finance';
import {
  computeExpiryTimestamp,
  loadAiSettings,
  saveAiSettings,
  type ProviderAvailabilityMap,
} from './utils/aiSettings';
import {
  decryptVaultEnvelope,
  encryptVaultPayload,
  isEncryptedEnvelope,
  readVaultRecord,
  saveEncryptedLocalVault,
  savePlaintextLocalVault,
  shredLocalVault,
} from './utils/cryptoVault';
import { generateSample14MonthData } from './utils/sampleData';
import {
  applyCategorySuggestions,
  evaluateAdvancedRules,
  runLocalFinancialAnalytics,
} from './utils/analyticsEngine';
import { buildDedupKey } from './utils/statementParser';
import {
  applyBatchTransactionUpdate,
  type BatchTransactionUpdate,
} from './utils/ledgerFilters';
import { generateCurrentMonthSummaryPdfDocument } from './utils/pdfReportGenerator';
import { saveEncryptedVaultDocument, savePdfDocument } from './utils/documentSave';
import { OverviewView } from './components/OverviewView';
import { SubscriptionsView } from './components/SubscriptionsView';
import { CutSavingsView } from './components/CutSavingsView';
import { WealthPlannerView } from './components/WealthPlannerView';
import { DebtView } from './components/DebtView';
import { PlannerNotesView } from './components/PlannerNotesView';
import { LedgerView } from './components/LedgerView';
import { ReportsView } from './components/ReportsView';
import { FaqView } from './components/FaqView';
import { VaultSecurityView } from './components/VaultSecurityView';
import { AiAdvisorView } from './components/AiAdvisorView';
import { FamilyShareView } from './components/FamilyShareView';
import { UploadSheet } from './components/UploadSheet';
import { LockScreen } from './components/LockScreen';
import { CapAlertBanner } from './components/CapAlertBanner';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { useCapPaceMonitor } from './hooks/useCapPaceMonitor';
import { usePayloadHistory } from './hooks/usePayloadHistory';

type ActiveTab =
  | 'overview'
  | 'subscriptions'
  | 'cuts'
  | 'wealth'
  | 'debt'
  | 'planner'
  | 'reports'
  | 'ai'
  | 'ledger'
  | 'family'
  | 'vault'
  | 'faq';

const NAV_ITEMS: Array<{
  id: ActiveTab;
  label: string;
  mobileLabel: string;
  breadcrumb: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'overview',
    label: 'Overview',
    mobileLabel: 'Overview',
    breadcrumb: 'Overview',
    icon: LayoutDashboard,
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    mobileLabel: 'Subs',
    breadcrumb: 'Recurring Subscriptions',
    icon: Repeat,
  },
  {
    id: 'cuts',
    label: 'Cut & Save',
    mobileLabel: 'Cut',
    breadcrumb: 'Cut & Save Optimizer',
    icon: Scissors,
  },
  {
    id: 'wealth',
    label: 'Cash ISA & Goals',
    mobileLabel: 'ISA Plan',
    breadcrumb: 'Cash ISA & Savings Goals',
    icon: PiggyBank,
  },
  {
    id: 'debt',
    label: 'Debt',
    mobileLabel: 'Debt',
    breadcrumb: 'Debt Payoff Simulator',
    icon: CreditCard,
  },
  {
    id: 'planner',
    label: 'Plan & Notes',
    mobileLabel: 'Planner',
    breadcrumb: 'Commitment Notes & Goal Planner',
    icon: NotebookPen,
  },
  {
    id: 'reports',
    label: 'Reports',
    mobileLabel: 'Reports',
    breadcrumb: 'Printable Monthly Reports',
    icon: FileText,
  },
  {
    id: 'ai',
    label: 'AI Advisor',
    mobileLabel: 'AI Advice',
    breadcrumb: 'Privacy-First AI Advisor',
    icon: Sparkles,
  },
  {
    id: 'ledger',
    label: 'Statements',
    mobileLabel: 'Ledger',
    breadcrumb: 'Bank Statement Ledger',
    icon: ListFilter,
  },
  {
    id: 'family',
    label: 'Family Share',
    mobileLabel: 'Family',
    breadcrumb: 'Encrypted Family Sharing',
    icon: Users,
  },
  {
    id: 'vault',
    label: 'Vault & Settings',
    mobileLabel: 'Settings',
    breadcrumb: 'Local Vault & Settings',
    icon: Shield,
  },
  {
    id: 'faq',
    label: 'FAQ & Help',
    mobileLabel: 'FAQ',
    breadcrumb: 'FAQ & API Key Hygiene',
    icon: HelpCircle,
  },
];

const MOBILE_PRIMARY_TABS: ActiveTab[] = ['overview', 'cuts', 'reports', 'ai', 'vault'];

export default function App() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [timeframe, setTimeframe] = useState<'all' | 12 | 6>('all');
  const [importOpen, setImportOpen] = useState(false);

  const history = usePayloadHistory();
  const payload = history.payload;
  const { resetPresent, commit: commitHistory, undo: undoHistory, redo: redoHistory } = history;

  const [lockedEnvelope, setLockedEnvelope] = useState<EncryptedVaultEnvelope | null>(null);
  const [activePassphrase, setActivePassphrase] = useState<string | null>(null);
  const [latestEnvelope, setLatestEnvelope] = useState<EncryptedVaultEnvelope | null>(null);
  const [historyBanner, setHistoryBanner] = useState<{
    direction: 'undo' | 'redo';
    label: string;
  } | null>(null);
  const historyBannerTimerRef = useRef<number | null>(null);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('clearledger_theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;
    }
  });

  const [aiSettings, setAiSettings] = useState<AiAssistantSettings>(() => loadAiSettings());
  const [providerStatus, setProviderStatus] = useState<ProviderAvailabilityMap | null>(null);
  const themeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem('clearledger_theme', darkMode ? 'dark' : 'light');
    } catch {
      // ignore storage errors
    }
  }, [darkMode]);

  // Trigger a subtle whole-app cross-fade when switching Light / Dark theme
  const handleSetDarkMode = useCallback(
    (nextDark: boolean) => {
      if (nextDark === darkMode) return;

      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

      const applyTheme = () => {
        document.documentElement.classList.toggle('dark', nextDark);
        flushSync(() => {
          setDarkMode(nextDark);
        });
      };

      if (prefersReducedMotion) {
        setDarkMode(nextDark);
        return;
      }

      const docWithTransition = document as Document & {
        startViewTransition?: (cb: () => void) => { finished: Promise<void> };
      };

      if (typeof docWithTransition.startViewTransition === 'function') {
        docWithTransition.startViewTransition(applyTheme);
        return;
      }

      // Graceful CSS cross-fade fallback for browsers without View Transitions API
      if (themeTimerRef.current !== null) {
        window.clearTimeout(themeTimerRef.current);
      }
      document.documentElement.classList.add('theme-transitioning');
      applyTheme();
      themeTimerRef.current = window.setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
        themeTimerRef.current = null;
      }, 300);
    },
    [darkMode]
  );

  useEffect(() => {
    return () => {
      if (themeTimerRef.current !== null) {
        window.clearTimeout(themeTimerRef.current);
      }
      if (historyBannerTimerRef.current !== null) {
        window.clearTimeout(historyBannerTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    saveAiSettings(aiSettings);
  }, [aiSettings]);

  // Fetch boolean availability of server-side providers once (never any secret values)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/ai-providers');
        if (!res.ok) return;
        const data = (await res.json()) as { providers?: ProviderAvailabilityMap };
        if (active && data.providers) {
          setProviderStatus(data.providers);
        }
      } catch {
        // ignore offline errors
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Automatically turn AI provider back to Off when retention window expires
  useEffect(() => {
    if (aiSettings.provider === 'off' || aiSettings.expiresAt === null) return;
    const msLeft = aiSettings.expiresAt - Date.now();
    if (msLeft <= 0) {
      setAiSettings((prev) => ({ ...prev, provider: 'off', expiresAt: null }));
      return;
    }
    const timer = window.setTimeout(
      () => {
        setAiSettings((prev) => ({ ...prev, provider: 'off', expiresAt: null }));
      },
      Math.min(msLeft, 2_147_483_000)
    );
    return () => window.clearTimeout(timer);
  }, [aiSettings.provider, aiSettings.expiresAt]);

  const handleUpdateAiProvider = useCallback((provider: AiProviderSetting) => {
    setAiSettings((prev) => ({
      ...prev,
      provider,
      expiresAt: computeExpiryTimestamp(provider, prev.retention),
    }));
  }, []);

  const handleUpdateAiRetention = useCallback((retention: AiRetentionOption) => {
    setAiSettings((prev) => ({
      ...prev,
      retention,
      expiresAt: computeExpiryTimestamp(prev.provider, retention),
    }));
  }, []);

  const handleUpdateAiRatiosOnly = useCallback((ratiosOnly: boolean) => {
    setAiSettings((prev) => ({ ...prev, ratiosOnly }));
  }, []);

  const handleForgetAiSession = useCallback(() => {
    setAiSettings((prev) => ({
      ...prev,
      provider: 'off',
      expiresAt: null,
    }));
  }, []);

  // Bootstrap from local IndexedDB (zero cloud calls)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = await readVaultRecord();
        if (!active) return;

        if (!stored) {
          const initial = generateSample14MonthData();
          await savePlaintextLocalVault(initial);
          resetPresent(initial);
        } else if (stored.mode === 'encrypted_aes_gcm' && stored.envelope) {
          setLockedEnvelope(stored.envelope);
          setLatestEnvelope(stored.envelope);
        } else if (stored.plaintext) {
          const loaded = stored.plaintext;
          const needsUpgrade =
            !loaded.categoryRules ||
            !loaded.plannerState ||
            !loaded.debts ||
            !loaded.exchangeRates ||
            !loaded.advancedRules ||
            (loaded.isSampleData &&
              (!loaded.categoryCaps || !loaded.subscriptionClassOverrides));
          if (needsUpgrade) {
            const defaults = generateSample14MonthData();
            const upgraded: VaultPayload = {
              ...loaded,
              exchangeRates: loaded.exchangeRates ?? { ...DEFAULT_EXCHANGE_RATES },
              categoryCaps: loaded.categoryCaps ?? (loaded.isSampleData ? defaults.categoryCaps : {}),
              subscriptionClassOverrides:
                loaded.subscriptionClassOverrides ??
                (loaded.isSampleData ? defaults.subscriptionClassOverrides : {}),
              categoryRules:
                loaded.categoryRules ?? (loaded.isSampleData ? defaults.categoryRules : []),
              advancedRules:
                loaded.advancedRules ?? (loaded.isSampleData ? defaults.advancedRules : []),
              plannerState:
                loaded.plannerState ??
                (loaded.isSampleData
                  ? defaults.plannerState
                  : {
                      commitmentDeclaration: '',
                      commitmentSignedName: '',
                      commitmentUpdatedAt: '',
                      struggles: [],
                      plannerGoals: [],
                    }),
              debts: loaded.debts ?? (loaded.isSampleData ? defaults.debts : []),
            };
            await savePlaintextLocalVault(upgraded);
            resetPresent(upgraded);
          } else {
            resetPresent(loaded);
          }
        } else {
          const fallback = generateSample14MonthData();
          resetPresent(fallback);
        }
      } catch {
        if (active) {
          resetPresent(generateSample14MonthData());
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [resetPresent]);

  const writeVaultSnapshot = useCallback(
    async (snapshot: VaultPayload, passphraseOverride?: string | null) => {
      const pass = passphraseOverride !== undefined ? passphraseOverride : activePassphrase;
      if (pass) {
        const env = await encryptVaultPayload(snapshot, pass);
        await saveEncryptedLocalVault(env);
        setLatestEnvelope(env);
      } else {
        await savePlaintextLocalVault(snapshot);
      }
    },
    [activePassphrase]
  );

  const showHistoryNotice = useCallback((direction: 'undo' | 'redo', label: string) => {
    setHistoryBanner({ direction, label });
    if (historyBannerTimerRef.current !== null) {
      window.clearTimeout(historyBannerTimerRef.current);
    }
    historyBannerTimerRef.current = window.setTimeout(() => {
      setHistoryBanner(null);
      historyBannerTimerRef.current = null;
    }, 4500);
  }, []);

  // Persist locally (recording snapshot into global Undo/Redo stack and re-encrypting if active)
  const persistPayload = useCallback(
    async (
      next: VaultPayload,
      options?: {
        passphraseOverride?: string | null;
        label?: string;
        recordHistory?: boolean;
        resetHistory?: boolean;
        coalesceKey?: string;
      }
    ) => {
      const updated: VaultPayload = {
        ...next,
        updatedAt: new Date().toISOString(),
      };
      if (options?.resetHistory) {
        resetPresent(updated);
      } else {
        commitHistory(updated, {
          label: options?.label,
          recordHistory: options?.recordHistory ?? true,
          coalesceKey: options?.coalesceKey,
        });
      }
      await writeVaultSnapshot(updated, options?.passphraseOverride);
    },
    [commitHistory, resetPresent, writeVaultSnapshot]
  );

  const handleUndo = useCallback(() => {
    const res = undoHistory();
    if (!res) return;
    const restored: VaultPayload = {
      ...res.payload,
      updatedAt: new Date().toISOString(),
    };
    void writeVaultSnapshot(restored);
    showHistoryNotice('undo', res.undoneLabel);
  }, [undoHistory, writeVaultSnapshot, showHistoryNotice]);

  const handleRedo = useCallback(() => {
    const res = redoHistory();
    if (!res) return;
    const restored: VaultPayload = {
      ...res.payload,
      updatedAt: new Date().toISOString(),
    };
    void writeVaultSnapshot(restored);
    showHistoryNotice('redo', res.redoneLabel);
  }, [redoHistory, writeVaultSnapshot, showHistoryNotice]);

  // Global keyboard shortcuts (Ctrl/Cmd+Z for Undo, Ctrl+Y / Cmd+Shift+Z for Redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (!history.canUndo) return;
        e.preventDefault();
        handleUndo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (!history.canRedo) return;
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [history.canUndo, history.canRedo, handleUndo, handleRedo]);

  const analytics = useMemo(() => {
    if (!payload) {
      return runLocalFinancialAnalytics([], {}, {}, timeframe, {}, {}, 'GBP', DEFAULT_EXCHANGE_RATES);
    }
    return runLocalFinancialAnalytics(
      payload.transactions,
      payload.recurringActions,
      payload.recommendationOverrides,
      timeframe,
      payload.subscriptionClassOverrides ?? {},
      payload.categoryCaps ?? {},
      payload.currency,
      payload.exchangeRates
    );
  }, [payload, timeframe]);

  // Always compute full 12-month series for the D3 progress line chart regardless of bar-chart filter
  const twelveMonthSeries = useMemo(() => {
    if (!payload) return [];
    if (timeframe === 12 || timeframe === 'all') {
      return analytics.monthlySeries.slice(-12);
    }
    return runLocalFinancialAnalytics(
      payload.transactions,
      payload.recurringActions,
      payload.recommendationOverrides,
      12,
      payload.subscriptionClassOverrides ?? {},
      payload.categoryCaps ?? {},
      payload.currency,
      payload.exchangeRates
    ).monthlySeries;
  }, [payload, timeframe, analytics.monthlySeries]);

  // Local non-blocking background check for projected monthly category cap breaches
  const capMonitor = useCapPaceMonitor(
    payload?.transactions ?? [],
    payload?.categoryCaps,
    payload?.currency ?? 'GBP',
    payload?.exchangeRates
  );

  const handleReviewCaps = useCallback(() => {
    setActiveTab('overview');
    window.setTimeout(() => {
      document
        .getElementById('spending-caps-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }, []);

  const handleToggleRecommendation = useCallback(
    (id: string, enabled: boolean, activeCutPct: number) => {
      if (!payload) return;
      void persistPayload(
        {
          ...payload,
          recommendationOverrides: {
            ...payload.recommendationOverrides,
            [id]: { enabled, activeCutPct },
          },
        },
        { label: 'Updated savings cut plan', coalesceKey: `rec-${id}` }
      );
    },
    [payload, persistPayload]
  );

  const handleSetRecurringAction = useCallback(
    (recId: string, action: 'keep' | 'downgrade' | 'cancel') => {
      if (!payload) return;
      void persistPayload(
        {
          ...payload,
          recurringActions: {
            ...payload.recurringActions,
            [recId]: action,
          },
          subscriptionClassOverrides: {
            ...(payload.subscriptionClassOverrides ?? {}),
            ...(action === 'cancel' ? { [recId]: 'cancelable' as SubscriptionClass } : {}),
          },
        },
        { label: 'Updated recurring bill action' }
      );
    },
    [payload, persistPayload]
  );

  const handleSetSubscriptionClass = useCallback(
    (recId: string, nextClass: SubscriptionClass) => {
      if (!payload) return;
      void persistPayload(
        {
          ...payload,
          subscriptionClassOverrides: {
            ...(payload.subscriptionClassOverrides ?? {}),
            [recId]: nextClass,
          },
          recurringActions: {
            ...payload.recurringActions,
            [recId]: nextClass === 'cancelable' ? 'cancel' : 'keep',
          },
        },
        { label: 'Updated subscription classification' }
      );
    },
    [payload, persistPayload]
  );

  const handleUpdateCategoryCap = useCallback(
    (categoryId: CategoryId, cap: number | null) => {
      if (!payload) return;
      const nextCaps = { ...(payload.categoryCaps ?? {}) };
      if (cap === null || cap <= 0) {
        delete nextCaps[categoryId];
      } else {
        nextCaps[categoryId] = cap;
      }
      void persistPayload(
        {
          ...payload,
          categoryCaps: nextCaps,
        },
        { label: cap === null || cap <= 0 ? 'Cleared spending cap' : 'Updated spending cap' }
      );
    },
    [payload, persistPayload]
  );

  const handleUpdateIsaSettings = useCallback(
    (patch: Partial<IsaPlannerSettings>) => {
      if (!payload) return;
      void persistPayload(
        {
          ...payload,
          isaSettings: {
            ...payload.isaSettings,
            ...patch,
          },
        },
        { label: 'Updated ISA strategy', coalesceKey: 'isa-settings' }
      );
    },
    [payload, persistPayload]
  );

  const handleAddGoal = useCallback(
    (goal: Omit<SavingsGoal, 'id'>) => {
      if (!payload) return;
      const newGoal: SavingsGoal = {
        ...goal,
        id: `goal-${Date.now()}`,
      };
      void persistPayload(
        {
          ...payload,
          goals: [...payload.goals, newGoal],
        },
        { label: `Added goal "${goal.name}"` }
      );
    },
    [payload, persistPayload]
  );

  const handleDeleteGoal = useCallback(
    (id: string) => {
      if (!payload) return;
      const target = payload.goals.find((g) => g.id === id);
      void persistPayload(
        {
          ...payload,
          goals: payload.goals.filter((g) => g.id !== id),
        },
        { label: target ? `Deleted goal "${target.name}"` : 'Deleted savings goal' }
      );
    },
    [payload, persistPayload]
  );

  const handleUpdateTransaction = useCallback(
    (
      id: string,
      updates: Partial<Pick<Transaction, 'category' | 'spendingClass' | 'currency' | 'tags'>>
    ) => {
      if (!payload) return;
      const targetTx = payload.transactions.find((tx) => tx.id === id);
      const nextTransactions = payload.transactions.map((tx) =>
        tx.id === id ? { ...tx, ...updates } : tx
      );

      // Automatically save a local merchant rule whenever a user reclassifies a transaction
      let nextRules: CategoryRule[] = payload.categoryRules ?? [];
      if (targetTx && (updates.category || updates.spendingClass)) {
        const pattern = targetTx.merchant
          .toLowerCase()
          .replace(/[^a-z0-9&\s'-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (pattern.length >= 2) {
          const updatedCat = updates.category ?? targetTx.category;
          const updatedClass = updates.spendingClass ?? targetTx.spendingClass;
          const existingIdx = nextRules.findIndex((r) => r.matchPattern === pattern);
          const ruleEntry: CategoryRule = {
            id:
              existingIdx >= 0
                ? nextRules[existingIdx].id
                : `rule-${pattern.replace(/\s+/g, '-')}-${Date.now()}`,
            matchPattern: pattern,
            matchType: 'exact_merchant',
            category: updatedCat,
            spendingClass: updatedClass,
            source: 'manual',
            confidence: 99,
            matchCount: existingIdx >= 0 ? nextRules[existingIdx].matchCount + 1 : 1,
            updatedAt: new Date().toISOString(),
          };
          nextRules =
            existingIdx >= 0
              ? nextRules.map((r, i) => (i === existingIdx ? ruleEntry : r))
              : [ruleEntry, ...nextRules];
        }
      }

      const isTagOnlyUpdate =
        updates.tags !== undefined &&
        updates.category === undefined &&
        updates.spendingClass === undefined &&
        updates.currency === undefined;

      void persistPayload(
        {
          ...payload,
          transactions: nextTransactions,
          categoryRules: nextRules,
        },
        {
          label: targetTx
            ? isTagOnlyUpdate
              ? `Updated tags on "${targetTx.merchant}"`
              : `Updated "${targetTx.merchant}"`
            : 'Updated transaction',
        }
      );
    },
    [payload, persistPayload]
  );

  const handleBatchUpdateTransactions = useCallback(
    (ids: string[], update: BatchTransactionUpdate): number => {
      if (!payload || ids.length === 0) return 0;
      const selectedSet = new Set(ids);
      const { transactions: nextTransactions, updatedCount } = applyBatchTransactionUpdate(
        payload.transactions,
        selectedSet,
        update
      );
      if (updatedCount === 0) return 0;

      const summaryParts: string[] = [];
      if (update.category) summaryParts.push(CATEGORIES[update.category].label);
      if (update.addTag) summaryParts.push(`+#${update.addTag}`);
      if (update.removeTag) summaryParts.push(`-#${update.removeTag}`);

      void persistPayload(
        {
          ...payload,
          transactions: nextTransactions,
        },
        {
          label: `Batch updated ${updatedCount} transaction${updatedCount === 1 ? '' : 's'}${
            summaryParts.length > 0 ? ` (${summaryParts.join(', ')})` : ''
          }`,
        }
      );
      return updatedCount;
    },
    [payload, persistPayload]
  );

  const handleApplyCategorySuggestions = useCallback(
    (suggestions: CategoryRuleSuggestion[]) => {
      if (!payload || suggestions.length === 0) return;
      const updatedTx = applyCategorySuggestions(payload.transactions, suggestions);
      void persistPayload(
        {
          ...payload,
          transactions: updatedTx,
        },
        {
          label: `Applied ${suggestions.length} rule update${
            suggestions.length === 1 ? '' : 's'
          }`,
        }
      );
    },
    [payload, persistPayload]
  );

  const handleDeleteCategoryRule = useCallback(
    (ruleId: string) => {
      if (!payload) return;
      const target = (payload.categoryRules ?? []).find((r) => r.id === ruleId);
      void persistPayload(
        {
          ...payload,
          categoryRules: (payload.categoryRules ?? []).filter((r) => r.id !== ruleId),
        },
        {
          label: target
            ? `Deleted merchant rule "${target.matchPattern}"`
            : 'Deleted merchant rule',
        }
      );
    },
    [payload, persistPayload]
  );

  const handleAddAdvancedRule = useCallback(
    (
      ruleInput: Omit<AdvancedAutomationRule, 'id' | 'createdAt'>,
      applyImmediately = false
    ) => {
      if (!payload) return;
      const newRule: AdvancedAutomationRule = {
        ...ruleInput,
        id: `adv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
      };
      const nextAdvancedRules = [newRule, ...(payload.advancedRules ?? [])];
      let nextTransactions = payload.transactions;
      if (applyImmediately) {
        const matches = evaluateAdvancedRules(
          payload.transactions,
          [newRule],
          payload.currency,
          payload.exchangeRates
        );
        if (matches.length > 0) {
          nextTransactions = applyCategorySuggestions(payload.transactions, matches);
        }
      }
      void persistPayload(
        {
          ...payload,
          advancedRules: nextAdvancedRules,
          transactions: nextTransactions,
        },
        { label: `Added rule "${newRule.name}"` }
      );
    },
    [payload, persistPayload]
  );

  const handleToggleAdvancedRule = useCallback(
    (ruleId: string) => {
      if (!payload) return;
      const target = (payload.advancedRules ?? []).find((r) => r.id === ruleId);
      void persistPayload(
        {
          ...payload,
          advancedRules: (payload.advancedRules ?? []).map((r) =>
            r.id === ruleId ? { ...r, enabled: !r.enabled } : r
          ),
        },
        {
          label: target
            ? `${target.enabled ? 'Paused' : 'Enabled'} rule "${target.name}"`
            : 'Toggled conditional rule',
        }
      );
    },
    [payload, persistPayload]
  );

  const handleDeleteAdvancedRule = useCallback(
    (ruleId: string) => {
      if (!payload) return;
      const target = (payload.advancedRules ?? []).find((r) => r.id === ruleId);
      void persistPayload(
        {
          ...payload,
          advancedRules: (payload.advancedRules ?? []).filter((r) => r.id !== ruleId),
        },
        {
          label: target
            ? `Deleted conditional rule "${target.name}"`
            : 'Deleted conditional rule',
        }
      );
    },
    [payload, persistPayload]
  );

  const handleUpdatePlannerState = useCallback(
    (nextPlanner: PersonalPlannerState) => {
      if (!payload) return;
      void persistPayload(
        {
          ...payload,
          plannerState: nextPlanner,
        },
        { label: 'Updated planner & notes', coalesceKey: 'planner-state' }
      );
    },
    [payload, persistPayload]
  );

  const handleAddDebt = useCallback(
    (debt: Omit<DebtAccount, 'id'>) => {
      if (!payload) return;
      const newDebt: DebtAccount = {
        ...debt,
        id: `debt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      void persistPayload(
        {
          ...payload,
          debts: [...(payload.debts ?? []), newDebt],
        },
        { label: `Added debt "${debt.name}"` }
      );
    },
    [payload, persistPayload]
  );

  const handleUpdateDebt = useCallback(
    (id: string, patch: Partial<Omit<DebtAccount, 'id'>>) => {
      if (!payload) return;
      const target = (payload.debts ?? []).find((d) => d.id === id);
      void persistPayload(
        {
          ...payload,
          debts: (payload.debts ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)),
        },
        {
          label: target ? `Updated debt "${target.name}"` : 'Updated debt account',
          coalesceKey: `debt-${id}`,
        }
      );
    },
    [payload, persistPayload]
  );

  const handleDeleteDebt = useCallback(
    (id: string) => {
      if (!payload) return;
      const target = (payload.debts ?? []).find((d) => d.id === id);
      void persistPayload(
        {
          ...payload,
          debts: (payload.debts ?? []).filter((d) => d.id !== id),
        },
        { label: target ? `Deleted debt "${target.name}"` : 'Deleted debt account' }
      );
    },
    [payload, persistPayload]
  );

  const handleCommitImport = useCallback(
    (
      incoming: Transaction[],
      metas: StatementImportMeta[],
      replaceExisting: boolean
    ): { added: number; skipped: number } => {
      if (!payload) return { added: 0, skipped: 0 };

      const baseTx = replaceExisting ? [] : payload.transactions;
      const seen = new Set(baseTx.map(buildDedupKey));
      const uniqueIncoming: Transaction[] = [];
      let skipped = 0;

      const addedByBatch = new Map<string, Transaction[]>();
      const skippedByBatch = new Map<string, number>();

      for (const tx of incoming) {
        const key = buildDedupKey(tx);
        const batchKey = tx.importBatchId ?? tx.sourceFile ?? '';
        if (seen.has(key)) {
          skipped++;
          if (batchKey) {
            skippedByBatch.set(batchKey, (skippedByBatch.get(batchKey) ?? 0) + 1);
          }
        } else {
          seen.add(key);
          uniqueIncoming.push(tx);
          if (batchKey) {
            const list = addedByBatch.get(batchKey) ?? [];
            list.push(tx);
            addedByBatch.set(batchKey, list);
          }
        }
      }

      const enrichedMetas: StatementImportMeta[] = metas.map((meta) => {
        const addedList = addedByBatch.get(meta.id) ?? addedByBatch.get(meta.fileName);
        const skippedCount =
          skippedByBatch.get(meta.id) ?? skippedByBatch.get(meta.fileName) ?? 0;
        if (!addedList && skippedCount === 0) return meta;
        const dates = (addedList ?? []).map((t) => t.date).sort();
        return {
          ...meta,
          rowCount: addedList ? addedList.length : meta.rowCount,
          duplicatesSkipped: skippedCount,
          dateRangeStart: dates[0] ?? meta.dateRangeStart,
          dateRangeEnd: dates[dates.length - 1] ?? meta.dateRangeEnd,
        };
      });

      const merged = [...uniqueIncoming, ...baseTx].sort((a, b) =>
        b.date.localeCompare(a.date)
      );

      void persistPayload(
        {
          ...payload,
          isSampleData: false,
          transactions: merged,
          imports: replaceExisting
            ? enrichedMetas
            : [...enrichedMetas, ...payload.imports],
        },
        {
          label: `Imported ${uniqueIncoming.length} transaction${
            uniqueIncoming.length === 1 ? '' : 's'
          }`,
        }
      );

      return { added: uniqueIncoming.length, skipped };
    },
    [payload, persistPayload]
  );

  const handleDeleteImportBatch = useCallback(
    async (
      importId: string
    ): Promise<{ removedTransactions: number; fileName: string }> => {
      if (!payload) return { removedTransactions: 0, fileName: '' };
      const target = payload.imports.find((imp) => imp.id === importId);
      if (!target) return { removedTransactions: 0, fileName: '' };

      const remainingImports = payload.imports.filter((imp) => imp.id !== importId);
      const otherSharesFileName = remainingImports.some(
        (imp) => imp.fileName === target.fileName
      );

      const remainingTransactions = payload.transactions.filter((tx) => {
        if (tx.importBatchId) {
          return tx.importBatchId !== importId;
        }
        // Backwards-compatible fallback for older rows saved without importBatchId
        if (!otherSharesFileName && tx.sourceFile === target.fileName) {
          return false;
        }
        return true;
      });

      const removedTransactions =
        payload.transactions.length - remainingTransactions.length;

      await persistPayload(
        {
          ...payload,
          imports: remainingImports,
          transactions: remainingTransactions,
        },
        { label: `Deleted import batch "${target.fileName}"` }
      );

      return { removedTransactions, fileName: target.fileName };
    },
    [payload, persistPayload]
  );

  const handleMergeSharedTransactions = useCallback(
    (sharedTx: Transaction[], senderName: string): { added: number; skipped: number } => {
      const batchId = `family-merge-${Date.now()}`;
      const fileName = `Family Share: ${senderName}`;
      const tagged = sharedTx.map((t) => ({
        ...t,
        accountName: `${senderName} (${t.accountName})`,
        sourceFile: fileName,
        importBatchId: batchId,
      }));
      const dates = tagged.map((t) => t.date).sort();
      const meta: StatementImportMeta = {
        id: batchId,
        fileName,
        importedAt: new Date().toISOString(),
        rowCount: tagged.length,
        duplicatesSkipped: 0,
        dateRangeStart: dates[0] ?? '',
        dateRangeEnd: dates[dates.length - 1] ?? '',
      };
      return handleCommitImport(tagged, [meta], false);
    },
    [handleCommitImport]
  );

  const handleEnableEncryption = useCallback(
    async (passphrase: string) => {
      if (!payload) return;
      setActivePassphrase(passphrase);
      await persistPayload(payload, {
        passphraseOverride: passphrase,
        recordHistory: false,
      });
    },
    [payload, persistPayload]
  );

  const handleLockVaultNow = useCallback(() => {
    if (!latestEnvelope) return;
    setActivePassphrase(null);
    setHistoryBanner(null);
    resetPresent(null);
    setLockedEnvelope(latestEnvelope);
  }, [latestEnvelope, resetPresent]);

  const handleUnlockVault = useCallback(
    async (passphrase: string) => {
      if (!lockedEnvelope) return;
      const decrypted = await decryptVaultEnvelope(lockedEnvelope, passphrase);
      setActivePassphrase(passphrase);
      resetPresent(decrypted);
      setLockedEnvelope(null);
    },
    [lockedEnvelope, resetPresent]
  );

  const handleDisableEncryption = useCallback(async () => {
    if (!payload) return;
    setActivePassphrase(null);
    setLatestEnvelope(null);
    await persistPayload(payload, {
      passphraseOverride: null,
      recordHistory: false,
    });
  }, [payload, persistPayload]);

  const handleExportEncryptedVault = useCallback(
    async (passphraseOverride?: string) => {
      if (!payload) throw new Error('Vault is not loaded');
      const pass = passphraseOverride ?? activePassphrase;
      if (!pass) throw new Error('Passphrase required for export');

      const envelope = await encryptVaultPayload(payload, pass);
      return saveEncryptedVaultDocument(
        envelope,
        `clearledger_backup_${new Date().toISOString().slice(0, 10)}.vault.json`
      );
    },
    [payload, activePassphrase]
  );

  const handleImportEncryptedVault = useCallback(
    async (file: File, passphrase: string): Promise<string> => {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Selected file is not valid JSON.');
      }
      if (!isEncryptedEnvelope(parsed)) {
        throw new Error('File is not a valid Clearledger AES-256-GCM vault backup.');
      }
      const decrypted = await decryptVaultEnvelope(parsed, passphrase);
      setActivePassphrase(passphrase);
      await persistPayload(decrypted, {
        passphraseOverride: passphrase,
        resetHistory: true,
      });
      return `Decrypted and restored ${decrypted.transactions.length} transactions locally.`;
    },
    [persistPayload]
  );

  const handleCurrencyChange = useCallback(
    (currency: CurrencyCode) => {
      if (!payload || payload.currency === currency) return;
      const prevCurrency = payload.currency;
      const convertedCaps: Partial<Record<CategoryId, number>> = {};
      if (payload.categoryCaps) {
        for (const [catId, capVal] of Object.entries(payload.categoryCaps) as Array<
          [CategoryId, number | undefined]
        >) {
          if (typeof capVal === 'number' && capVal > 0) {
            convertedCaps[catId] = Math.round(
              convertAmount(capVal, prevCurrency, currency, payload.exchangeRates)
            );
          }
        }
      }
      void persistPayload(
        { ...payload, currency, categoryCaps: convertedCaps },
        { label: `Changed primary currency to ${currency}` }
      );
    },
    [payload, persistPayload]
  );

  const handleUpdateExchangeRates = useCallback(
    (exchangeRates: Partial<ExchangeRateTable>) => {
      if (!payload) return;
      void persistPayload(
        {
          ...payload,
          exchangeRates: {
            ...DEFAULT_EXCHANGE_RATES,
            ...(payload.exchangeRates ?? {}),
            ...exchangeRates,
          },
        },
        { label: 'Updated exchange rates', coalesceKey: 'exchange-rates' }
      );
    },
    [payload, persistPayload]
  );

  const handleResetSampleData = useCallback(async () => {
    const fresh = generateSample14MonthData();
    await persistPayload(fresh, { label: 'Loaded 14-month sample statements' });
  }, [persistPayload]);

  const handleShredAllData = useCallback(async () => {
    await shredLocalVault();
    setActivePassphrase(null);
    setLatestEnvelope(null);
    setLockedEnvelope(null);
    setHistoryBanner(null);
    const empty: VaultPayload = {
      ...generateSample14MonthData(),
      isSampleData: false,
      exchangeRates: { ...DEFAULT_EXCHANGE_RATES },
      transactions: [],
      imports: [],
      recurringActions: {},
      recommendationOverrides: {},
      categoryRules: [],
      advancedRules: [],
      debts: [],
      plannerState: {
        commitmentDeclaration: '',
        commitmentSignedName: '',
        commitmentUpdatedAt: '',
        struggles: [],
        plannerGoals: [],
      },
    };
    resetPresent(empty);
    await savePlaintextLocalVault(empty);
  }, [resetPresent]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Opening local vault…
        </p>
      </div>
    );
  }

  if (lockedEnvelope && !payload) {
    return (
      <LockScreen
        envelope={lockedEnvelope}
        onUnlock={handleUnlockVault}
        onResetVault={async () => {
          await shredLocalVault();
          const fresh = generateSample14MonthData();
          await savePlaintextLocalVault(fresh);
          setLockedEnvelope(null);
          setLatestEnvelope(null);
          resetPresent(fresh);
        }}
      />
    );
  }

  if (!payload) return null;

  const currentNav = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];

  return (
    <div className="safe-top-shell min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Windows / Desktop & Tablet Persistent Left Sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-[232px] xl:w-[252px] md:fixed md:inset-y-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-30">
        <div className="h-16 px-6 flex items-center border-b border-slate-200 dark:border-slate-800">
          <span className="text-lg font-bold tracking-tight font-display text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            Clearledger
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Workspace navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full min-h-[38px] px-3.5 py-2 rounded-lg flex items-center gap-3 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          {/* Dedicated Light / Dark Theme Toggle */}
          <div
            className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
            role="group"
            aria-label="Theme preference"
          >
            <button
              type="button"
              onClick={() => handleSetDarkMode(false)}
              aria-pressed={!darkMode}
              className={`min-h-[34px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                !darkMode
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => handleSetDarkMode(true)}
              aria-pressed={darkMode}
              className={`min-h-[34px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                darkMode
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Dark</span>
            </button>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <p className="font-medium text-slate-700 dark:text-slate-300">
              {activePassphrase ? 'AES-256-GCM Encrypted' : 'Local-Only Storage'}
            </p>
            <p>Zero cloud sync · On-device math</p>
          </div>

          {activePassphrase && (
            <button
              type="button"
              onClick={handleLockVaultNow}
              className="w-full min-h-[38px] inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              Lock Vault
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0 md:pl-[232px] xl:pl-[252px]">
        {/* Top Bar (Desktop Contextual Breadcrumb + Primary Action / Compact Mobile Header <= 52px) */}
        <header className="sticky safe-sticky-top z-20 h-[52px] md:h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="md:hidden text-base font-bold tracking-tight font-display text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
              Clearledger
            </span>
            <span className="hidden md:inline text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
              Personal Vault
            </span>
            <span className="hidden md:inline text-slate-300 dark:text-slate-700" aria-hidden="true">
              /
            </span>
            <span className="hidden md:inline text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
              {currentNav.breadcrumb}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Global Vault Undo / Redo Controls */}
            <div
              className="hidden sm:inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-x divide-slate-200 dark:divide-slate-700 overflow-hidden"
              role="group"
              aria-label="Undo and redo vault changes"
            >
              <button
                type="button"
                disabled={!history.canUndo}
                onClick={handleUndo}
                aria-label={
                  history.lastUndoLabel
                    ? `Undo: ${history.lastUndoLabel}`
                    : 'Undo last change'
                }
                title={
                  history.lastUndoLabel
                    ? `Undo: ${history.lastUndoLabel} (Ctrl+Z)`
                    : 'Nothing to undo (Ctrl+Z)'
                }
                className="min-w-[38px] min-h-[38px] px-2 inline-flex items-center justify-center gap-1 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <Undo2 className="w-4 h-4" />
                <span className="hidden xl:inline text-xs font-medium">Undo</span>
              </button>
              <button
                type="button"
                disabled={!history.canRedo}
                onClick={handleRedo}
                aria-label={
                  history.nextRedoLabel
                    ? `Redo: ${history.nextRedoLabel}`
                    : 'Redo change'
                }
                title={
                  history.nextRedoLabel
                    ? `Redo: ${history.nextRedoLabel} (Ctrl+Y)`
                    : 'Nothing to redo (Ctrl+Y)'
                }
                className="min-w-[38px] min-h-[38px] px-2 inline-flex items-center justify-center gap-1 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <Redo2 className="w-4 h-4" />
                <span className="hidden xl:inline text-xs font-medium">Redo</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('faq')}
              aria-label="Open FAQ and Help"
              className={`md:hidden min-h-[40px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'faq'
                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>FAQ</span>
            </button>
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => handleSetDarkMode(!darkMode)}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 md:px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Import Statements</span>
              <span className="sm:hidden">Import</span>
            </button>
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 w-full max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-10">
          {/* Transient Undo / Redo Confirmation Strip */}
          {historyBanner && (
            <div
              role="status"
              className="mb-4 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs shadow-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                {historyBanner.direction === 'undo' ? (
                  <Undo2 className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                ) : (
                  <Redo2 className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                )}
                <span className="text-slate-700 dark:text-slate-200 truncate">
                  {historyBanner.direction === 'undo' ? 'Reverted' : 'Reapplied'}:{' '}
                  <strong className="font-medium text-slate-900 dark:text-slate-100">
                    {historyBanner.label}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {historyBanner.direction === 'undo' && history.canRedo && (
                  <button
                    type="button"
                    onClick={handleRedo}
                    className="font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                  >
                    Redo
                  </button>
                )}
                {historyBanner.direction === 'redo' && history.canUndo && (
                  <button
                    type="button"
                    onClick={handleUndo}
                    className="font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                  >
                    Undo
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setHistoryBanner(null)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Local Background Spending-Cap Projection Notification Banner */}
          <CapAlertBanner
            alerts={capMonitor.visibleAlerts}
            currency={payload.currency}
            onDismiss={capMonitor.dismiss}
            onReviewCaps={handleReviewCaps}
          />

          {/* Mobile Secondary Switcher for Vault / ISA / Debt / Planner / Subscriptions / Statements / Family / FAQ */}
          {(activeTab === 'vault' ||
            activeTab === 'wealth' ||
            activeTab === 'debt' ||
            activeTab === 'planner' ||
            activeTab === 'family' ||
            activeTab === 'ledger' ||
            activeTab === 'subscriptions' ||
            activeTab === 'faq') && (
            <div className="md:hidden mb-5 inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto max-w-full">
              {(
                [
                  { id: 'debt', label: 'Debt' },
                  { id: 'planner', label: 'Plan & Notes' },
                  { id: 'wealth', label: 'ISA & Goals' },
                  { id: 'subscriptions', label: 'Subscriptions' },
                  { id: 'ledger', label: 'Statements' },
                  { id: 'family', label: 'Family' },
                  { id: 'vault', label: 'Vault' },
                  { id: 'faq', label: 'FAQ' },
                ] as const
              ).map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setActiveTab(sub.id)}
                  className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === sub.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'overview' && (
            <OverviewView
              analytics={analytics}
              twelveMonthSeries={twelveMonthSeries}
              transactions={payload.transactions}
              currency={payload.currency}
              exchangeRates={payload.exchangeRates}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              onUpdateCategoryCap={handleUpdateCategoryCap}
              onNavigate={setActiveTab}
              onOpenImport={() => setImportOpen(true)}
              onExportCurrentMonthPdf={() => {
                const { doc, fileName } = generateCurrentMonthSummaryPdfDocument({
                  transactions: payload.transactions,
                  analytics,
                  categoryCaps: payload.categoryCaps,
                  isaSettings: payload.isaSettings,
                  debts: payload.debts ?? [],
                  currency: payload.currency,
                  exchangeRates: payload.exchangeRates,
                });
                return savePdfDocument(doc, fileName);
              }}
              isSampleData={payload.isSampleData}
            />
          )}

          {activeTab === 'subscriptions' && (
            <SubscriptionsView
              analytics={analytics}
              currency={payload.currency}
              recurringActions={payload.recurringActions}
              onSetSubscriptionClass={handleSetSubscriptionClass}
              onSetRecurringAction={handleSetRecurringAction}
              onNavigateWealth={() => setActiveTab('wealth')}
            />
          )}

          {activeTab === 'cuts' && (
            <CutSavingsView
              analytics={analytics}
              currency={payload.currency}
              onToggleRecommendation={handleToggleRecommendation}
              onSetRecurringAction={handleSetRecurringAction}
              onNavigateWealth={() => setActiveTab('wealth')}
            />
          )}

          {activeTab === 'wealth' && (
            <WealthPlannerView
              analytics={analytics}
              currency={payload.currency}
              settings={payload.isaSettings}
              goals={payload.goals}
              debts={payload.debts ?? []}
              onUpdateSettings={handleUpdateIsaSettings}
              onAddGoal={handleAddGoal}
              onDeleteGoal={handleDeleteGoal}
              onNavigateDebt={() => setActiveTab('debt')}
            />
          )}

          {activeTab === 'debt' && (
            <DebtView
              debts={payload.debts ?? []}
              analytics={analytics}
              isaSettings={payload.isaSettings}
              currency={payload.currency}
              onAddDebt={handleAddDebt}
              onUpdateDebt={handleUpdateDebt}
              onDeleteDebt={handleDeleteDebt}
              onNavigateWealth={() => setActiveTab('wealth')}
            />
          )}

          {activeTab === 'planner' && (
            <PlannerNotesView
              plannerState={
                payload.plannerState ?? {
                  commitmentDeclaration: '',
                  commitmentSignedName: '',
                  commitmentUpdatedAt: '',
                  struggles: [],
                  plannerGoals: [],
                }
              }
              onUpdatePlannerState={handleUpdatePlannerState}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsView
              transactions={payload.transactions}
              analytics={analytics}
              categoryCaps={payload.categoryCaps}
              isaSettings={payload.isaSettings}
              debts={payload.debts ?? []}
              currency={payload.currency}
              exchangeRates={payload.exchangeRates}
              onOpenImport={() => setImportOpen(true)}
            />
          )}

          {activeTab === 'ai' && (
            <AiAdvisorView
              analytics={analytics}
              isaSettings={payload.isaSettings}
              goals={payload.goals}
              currency={payload.currency}
              transactionCount={payload.transactions.length}
              aiSettings={aiSettings}
              providerStatus={providerStatus}
              onUpdateAiProvider={handleUpdateAiProvider}
              onUpdateAiRetention={handleUpdateAiRetention}
              onUpdateAiRatiosOnly={handleUpdateAiRatiosOnly}
              onForgetAiSession={handleForgetAiSession}
              onNavigateSettings={() => setActiveTab('vault')}
            />
          )}

          {activeTab === 'ledger' && (
            <LedgerView
              transactions={payload.transactions}
              imports={payload.imports}
              currency={payload.currency}
              exchangeRates={payload.exchangeRates}
              categoryRules={payload.categoryRules ?? []}
              advancedRules={payload.advancedRules ?? []}
              onUpdateTransaction={handleUpdateTransaction}
              onBatchUpdateTransactions={handleBatchUpdateTransactions}
              onApplySuggestions={handleApplyCategorySuggestions}
              onDeleteRule={handleDeleteCategoryRule}
              onAddAdvancedRule={handleAddAdvancedRule}
              onToggleAdvancedRule={handleToggleAdvancedRule}
              onDeleteAdvancedRule={handleDeleteAdvancedRule}
              onOpenImport={() => setImportOpen(true)}
            />
          )}

          {activeTab === 'family' && (
            <FamilyShareView
              analytics={analytics}
              currency={payload.currency}
              goals={payload.goals}
              isaSettings={payload.isaSettings}
              transactions={payload.transactions}
              onMergeSharedTransactions={handleMergeSharedTransactions}
            />
          )}

          {activeTab === 'vault' && (
            <VaultSecurityView
              isEncrypted={Boolean(activePassphrase)}
              envelope={latestEnvelope}
              currency={payload.currency}
              exchangeRates={payload.exchangeRates}
              darkMode={darkMode}
              transactionCount={payload.transactions.length}
              transactions={payload.transactions}
              imports={payload.imports}
              isSampleData={payload.isSampleData}
              aiSettings={aiSettings}
              providerStatus={providerStatus}
              onUpdateAiProvider={handleUpdateAiProvider}
              onUpdateAiRetention={handleUpdateAiRetention}
              onUpdateAiRatiosOnly={handleUpdateAiRatiosOnly}
              onForgetAiSession={handleForgetAiSession}
              onNavigateAi={() => setActiveTab('ai')}
              onEnableEncryption={handleEnableEncryption}
              onLockVaultNow={handleLockVaultNow}
              onDisableEncryption={handleDisableEncryption}
              onExportEncryptedVault={handleExportEncryptedVault}
              onImportEncryptedVault={handleImportEncryptedVault}
              onDeleteImportBatch={handleDeleteImportBatch}
              onOpenImport={() => setImportOpen(true)}
              onCurrencyChange={handleCurrencyChange}
              onUpdateExchangeRates={handleUpdateExchangeRates}
              onToggleDarkMode={() => handleSetDarkMode(!darkMode)}
              onResetSampleData={handleResetSampleData}
              onShredAllData={handleShredAllData}
            />
          )}

          {activeTab === 'faq' && <FaqView onNavigate={setActiveTab} />}
        </main>
      </div>

      {/* Mobile Fixed Thumb-Zone Bottom Tab Bar (5 tabs, <= 58px) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe"
      >
        <div className="grid grid-cols-5 h-[58px]">
          {MOBILE_PRIMARY_TABS.map((tabId) => {
            const item = NAV_ITEMS.find((n) => n.id === tabId)!;
            const Icon = item.icon;
            const active =
              activeTab === item.id ||
              (item.id === 'vault' &&
                (activeTab === 'wealth' ||
                  activeTab === 'debt' ||
                  activeTab === 'planner' ||
                  activeTab === 'family' ||
                  activeTab === 'ledger' ||
                  activeTab === 'subscriptions' ||
                  activeTab === 'faq'));
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                  active
                    ? 'text-teal-700 dark:text-teal-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium tracking-tight leading-none">
                  {item.mobileLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Multi-file Bank Statement Importer Modal / Bottom Sheet */}
      <UploadSheet
        open={importOpen}
        isSampleData={payload.isSampleData}
        existingTransactions={payload.transactions}
        savedRules={payload.categoryRules}
        advancedRules={payload.advancedRules}
        primaryCurrency={payload.currency}
        exchangeRates={payload.exchangeRates}
        onClose={() => setImportOpen(false)}
        onCommitImport={handleCommitImport}
      />

      {/* Offline Connectivity Indicator */}
      <OfflineIndicator />
    </div>
  );
}
