import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Play,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  CATEGORIES,
  CURRENCY_CONFIG,
  formatMoney,
  getTransactionDisplayAmount,
  type AdvancedAutomationRule,
  type AmountOperator,
  type CategoryId,
  type CategoryRule,
  type CategoryRuleSuggestion,
  type CurrencyCode,
  type ExchangeRateTable,
  type SpendingClass,
  type StatementImportMeta,
  type Transaction,
} from '../types/finance';
import { exportTransactionsToCsv } from '../utils/statementParser';
import {
  analyzeLedgerSmartTags,
  buildLearnedCategoryRules,
  describeAdvancedRuleCondition,
  evaluateAdvancedRules,
  matchesAdvancedRule,
  suggestCategoryMappings,
} from '../utils/analyticsEngine';

interface LedgerViewProps {
  transactions: Transaction[];
  imports: StatementImportMeta[];
  currency: CurrencyCode;
  exchangeRates?: Partial<ExchangeRateTable>;
  categoryRules: CategoryRule[];
  advancedRules: AdvancedAutomationRule[];
  onUpdateTransaction: (
    id: string,
    updates: Partial<Pick<Transaction, 'category' | 'spendingClass' | 'currency'>>
  ) => void;
  onApplySuggestions: (suggestions: CategoryRuleSuggestion[]) => void;
  onDeleteRule: (ruleId: string) => void;
  onAddAdvancedRule: (
    rule: Omit<AdvancedAutomationRule, 'id' | 'createdAt'>,
    applyImmediately?: boolean
  ) => void;
  onToggleAdvancedRule: (ruleId: string) => void;
  onDeleteAdvancedRule: (ruleId: string) => void;
  onOpenImport: () => void;
}

const CURRENCY_CODES = Object.keys(CURRENCY_CONFIG) as CurrencyCode[];

export const LedgerView: React.FC<LedgerViewProps> = ({
  transactions,
  imports,
  currency,
  exchangeRates,
  categoryRules,
  advancedRules,
  onUpdateTransaction,
  onApplySuggestions,
  onDeleteRule,
  onAddAdvancedRule,
  onToggleAdvancedRule,
  onDeleteAdvancedRule,
  onOpenImport,
}) => {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<'all' | SpendingClass>('all');
  const [smartTagFilter, setSmartTagFilter] = useState<
    'all' | 'tax_deductible' | 'expense_claimable' | 'any_smart_tag'
  >('all');
  const [currencyFilter, setCurrencyFilter] = useState<'all' | CurrencyCode>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [visibleLimit, setVisibleLimit] = useState(60);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [rulesTab, setRulesTab] = useState<'advanced' | 'learned'>('advanced');

  // Conditional Advanced Rule builder state
  const [ruleName, setRuleName] = useState('');
  const [ruleMerchant, setRuleMerchant] = useState('');
  const [ruleOperator, setRuleOperator] = useState<AmountOperator>('gt');
  const [ruleAmount, setRuleAmount] = useState('50');
  const [ruleAmountMax, setRuleAmountMax] = useState('');
  const [ruleCurrency, setRuleCurrency] = useState<CurrencyCode | 'any'>('any');
  const [ruleTargetClass, setRuleTargetClass] = useState<SpendingClass>('essential');
  const [ruleTargetCategory, setRuleTargetCategory] = useState<CategoryId | ''>('');

  const currencySymbol = CURRENCY_CONFIG[currency].symbol;

  const presentCurrencies = useMemo(() => {
    const set = new Set<CurrencyCode>();
    for (const tx of transactions) {
      set.add(tx.currency ?? currency);
    }
    return Array.from(set);
  }, [transactions, currency]);

  const learnedRules = useMemo(
    () => buildLearnedCategoryRules(transactions, categoryRules),
    [transactions, categoryRules]
  );

  const liveSuggestions = useMemo(
    () =>
      suggestCategoryMappings(
        transactions,
        transactions,
        categoryRules,
        advancedRules,
        currency,
        exchangeRates
      ),
    [transactions, categoryRules, advancedRules, currency, exchangeRates]
  );

  // Live preview of the conditional rule currently being drafted
  const draftRule = useMemo<AdvancedAutomationRule | null>(() => {
    const hasMerchant = ruleMerchant.trim().length > 0;
    const parsedAmt = ruleAmount.trim() !== '' ? Number(ruleAmount) : undefined;
    const parsedMax = ruleAmountMax.trim() !== '' ? Number(ruleAmountMax) : undefined;
    const hasAmount =
      ruleOperator !== 'any' && typeof parsedAmt === 'number' && Number.isFinite(parsedAmt) && parsedAmt >= 0;
    const hasCurrency = ruleCurrency !== 'any';
    if (!hasMerchant && !hasAmount && !hasCurrency) return null;

    return {
      id: 'draft-preview',
      name: ruleName.trim(),
      enabled: true,
      merchantContains: ruleMerchant.trim(),
      amountOperator: hasAmount ? ruleOperator : 'any',
      amountValue: hasAmount ? parsedAmt : undefined,
      amountMax:
        ruleOperator === 'between' && typeof parsedMax === 'number' && Number.isFinite(parsedMax)
          ? parsedMax
          : undefined,
      currencyFilter: ruleCurrency,
      targetCategory: ruleTargetCategory || undefined,
      targetSpendingClass: ruleTargetClass,
      createdAt: '',
    };
  }, [
    ruleName,
    ruleMerchant,
    ruleOperator,
    ruleAmount,
    ruleAmountMax,
    ruleCurrency,
    ruleTargetCategory,
    ruleTargetClass,
  ]);

  const draftPreviewStats = useMemo(() => {
    if (!draftRule) return { matched: 0, wouldUpdate: 0 };
    let matched = 0;
    let wouldUpdate = 0;
    for (const tx of transactions) {
      if (matchesAdvancedRule(tx, draftRule, currency, exchangeRates)) {
        matched++;
        const nextCat = draftRule.targetCategory ?? tx.category;
        if (tx.category !== nextCat || tx.spendingClass !== draftRule.targetSpendingClass) {
          wouldUpdate++;
        }
      }
    }
    return { matched, wouldUpdate };
  }, [draftRule, transactions, currency, exchangeRates]);

  const ruleMatchCounts = useMemo(() => {
    const map = new Map<string, { matched: number; pending: number }>();
    for (const rule of advancedRules) {
      let matched = 0;
      let pending = 0;
      const evalRule = { ...rule, enabled: true };
      for (const tx of transactions) {
        if (matchesAdvancedRule(tx, evalRule, currency, exchangeRates)) {
          matched++;
          const nextCat = rule.targetCategory ?? tx.category;
          if (tx.category !== nextCat || tx.spendingClass !== rule.targetSpendingClass) {
            pending++;
          }
        }
      }
      map.set(rule.id, { matched, pending });
    }
    return map;
  }, [advancedRules, transactions, currency, exchangeRates]);

  const months = useMemo(() => {
    return Array.from(new Set(transactions.map((t) => t.date.slice(0, 7)))).sort().reverse();
  }, [transactions]);

  const smartTagSummary = useMemo(
    () => analyzeLedgerSmartTags(transactions, currency, exchangeRates),
    [transactions, currency, exchangeRates]
  );

  const parsedMin = minAmount.trim() !== '' ? Number(minAmount) : null;
  const parsedMax = maxAmount.trim() !== '' ? Number(maxAmount) : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (classFilter !== 'all' && tx.spendingClass !== classFilter) return false;

      const txSmartTags = smartTagSummary.byTransactionId[tx.id] ?? [];
      if (smartTagFilter === 'tax_deductible') {
        if (!txSmartTags.some((t) => t.tag === 'tax_deductible')) return false;
      } else if (smartTagFilter === 'expense_claimable') {
        if (!txSmartTags.some((t) => t.tag === 'expense_claimable')) return false;
      } else if (smartTagFilter === 'any_smart_tag') {
        if (txSmartTags.length === 0) return false;
      }

      const txCurr = tx.currency ?? currency;
      if (currencyFilter !== 'all' && txCurr !== currencyFilter) return false;
      if (monthFilter !== 'all' && !tx.date.startsWith(monthFilter)) return false;
      if (dateFrom && tx.date < dateFrom) return false;
      if (dateTo && tx.date > dateTo) return false;

      const absConverted = Math.abs(
        getTransactionDisplayAmount(tx, currency, exchangeRates)
      );
      if (parsedMin !== null && Number.isFinite(parsedMin) && absConverted < parsedMin) {
        return false;
      }
      if (parsedMax !== null && Number.isFinite(parsedMax) && absConverted > parsedMax) {
        return false;
      }

      if (q) {
        const smartText = txSmartTags.map((t) => `${t.label} ${t.reason}`).join(' ');
        const hay = `${tx.merchant} ${tx.description} ${tx.date} ${CATEGORIES[tx.category].label} ${tx.accountName} ${txCurr} ${smartText}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    transactions,
    classFilter,
    smartTagFilter,
    smartTagSummary,
    currencyFilter,
    monthFilter,
    dateFrom,
    dateTo,
    parsedMin,
    parsedMax,
    search,
    currency,
    exchangeRates,
  ]);

  const isFiltered =
    search.trim().length > 0 ||
    classFilter !== 'all' ||
    smartTagFilter !== 'all' ||
    currencyFilter !== 'all' ||
    monthFilter !== 'all' ||
    minAmount.trim().length > 0 ||
    maxAmount.trim().length > 0 ||
    dateFrom.length > 0 ||
    dateTo.length > 0;

  const filteredTotals = useMemo(() => {
    let outflows = 0;
    let inflows = 0;
    for (const tx of filtered) {
      const converted = getTransactionDisplayAmount(tx, currency, exchangeRates);
      if (converted < 0) outflows += Math.abs(converted);
      else inflows += converted;
    }
    return { outflows, inflows };
  }, [filtered, currency, exchangeRates]);

  const handleResetFilters = () => {
    setSearch('');
    setClassFilter('all');
    setSmartTagFilter('all');
    setCurrencyFilter('all');
    setMonthFilter('all');
    setMinAmount('');
    setMaxAmount('');
    setDateFrom('');
    setDateTo('');
    setVisibleLimit(60);
  };

  const handleDownloadCsv = (rowsToExport: Transaction[], suffix: string) => {
    if (rowsToExport.length === 0) return;
    const csv = exportTransactionsToCsv(rowsToExport, currency);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const fileName = `clearledger_${suffix}_${new Date().toISOString().slice(0, 10)}.csv`;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    setExportNotice(
      `Exported ${rowsToExport.length} transaction${rowsToExport.length === 1 ? '' : 's'} locally to ${fileName}.`
    );
    window.setTimeout(() => setExportNotice(null), 4000);
  };

  const handleSaveAdvancedRule = (applyImmediately: boolean) => {
    if (!draftRule) return;
    const autoName =
      draftRule.name ||
      `${describeAdvancedRuleCondition(draftRule, currency)} → ${
        draftRule.targetSpendingClass === 'essential'
          ? 'Essential'
          : draftRule.targetSpendingClass === 'non-essential'
            ? 'Non-Essential'
            : draftRule.targetSpendingClass === 'savings'
              ? 'ISA / Savings'
              : 'Income'
      }`;

    onAddAdvancedRule(
      {
        name: autoName,
        enabled: true,
        merchantContains: draftRule.merchantContains,
        amountOperator: draftRule.amountOperator,
        amountValue: draftRule.amountValue,
        amountMax: draftRule.amountMax,
        currencyFilter: draftRule.currencyFilter,
        targetCategory: draftRule.targetCategory,
        targetSpendingClass: draftRule.targetSpendingClass,
      },
      applyImmediately
    );

    setExportNotice(
      applyImmediately
        ? `Saved "${autoName}" and updated ${draftPreviewStats.wouldUpdate} matching transaction${
            draftPreviewStats.wouldUpdate === 1 ? '' : 's'
          }.`
        : `Saved conditional rule "${autoName}".`
    );
    window.setTimeout(() => setExportNotice(null), 4500);

    setRuleName('');
    setRuleMerchant('');
    setRuleAmount('');
    setRuleAmountMax('');
    setRuleTargetCategory('');
  };

  const handleRunSingleAdvancedRule = (rule: AdvancedAutomationRule) => {
    const matches = evaluateAdvancedRules(
      transactions,
      [{ ...rule, enabled: true }],
      currency,
      exchangeRates
    );
    if (matches.length === 0) {
      setExportNotice(`All transactions matching "${rule.name}" are already classified.`);
      window.setTimeout(() => setExportNotice(null), 3500);
      return;
    }
    onApplySuggestions(matches);
    setExportNotice(
      `Rule "${rule.name}" updated ${matches.length} transaction${matches.length === 1 ? '' : 's'}.`
    );
    window.setTimeout(() => setExportNotice(null), 4000);
  };

  const toggleEssentialClass = (tx: Transaction) => {
    if (tx.spendingClass === 'income' || tx.spendingClass === 'savings') return;
    const nextClass: SpendingClass =
      tx.spendingClass === 'essential' ? 'non-essential' : 'essential';
    onUpdateTransaction(tx.id, { spendingClass: nextClass });
  };

  const activeAdvancedCount = advancedRules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Bank Statement Ledger
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono-num">{transactions.length} transactions</span>
            <span aria-hidden="true">·</span>
            <span>{imports.length} statement file{imports.length === 1 ? '' : 's'} imported</span>
            {presentCurrencies.length > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-teal-700 dark:text-teal-400 font-medium">
                  Mixed currencies ({presentCurrencies.join(', ')}) converted to {currency}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {isFiltered && filtered.length > 0 && (
            <button
              type="button"
              onClick={() => handleDownloadCsv(filtered, 'filtered_ledger')}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Filtered ({filtered.length})
            </button>
          )}
          <button
            type="button"
            disabled={transactions.length === 0}
            onClick={() => handleDownloadCsv(transactions, 'full_ledger')}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Ledger CSV
          </button>
          <button
            type="button"
            onClick={onOpenImport}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Statements
          </button>
        </div>
      </div>

      {exportNotice && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs font-medium text-teal-900 dark:text-teal-200"
        >
          {exportNotice}
        </div>
      )}

      {/* Search & Multi-Criteria Filter Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        {/* Row 1: Description Search + Class Segmented Filter */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-lg">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              aria-label="Search transactions by description, merchant, or category"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setVisibleLimit(60);
              }}
              placeholder="Smart Search: merchant, description, category, tax deductible, or claimable..."
              className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          <div className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto max-w-full">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'essential', label: 'Essential' },
                { id: 'non-essential', label: 'Non-Essential' },
                { id: 'income', label: 'Income' },
                { id: 'savings', label: 'ISA / Savings' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setClassFilter(f.id);
                  setVisibleLimit(60);
                }}
                className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  classFilter === f.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Amount Range + Date Range + Quick Month + Currency Filter */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-2">
            <label
              htmlFor="ledger-min-amount"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Min ({currencySymbol} equiv.)
            </label>
            <input
              id="ledger-min-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={minAmount}
              onChange={(e) => {
                setMinAmount(e.target.value);
                setVisibleLimit(60);
              }}
              placeholder="0.00"
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono-num text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="ledger-max-amount"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Max ({currencySymbol} equiv.)
            </label>
            <input
              id="ledger-max-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={maxAmount}
              onChange={(e) => {
                setMaxAmount(e.target.value);
                setVisibleLimit(60);
              }}
              placeholder="Any"
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono-num text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="ledger-date-from"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              From Date
            </label>
            <input
              id="ledger-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setMonthFilter('all');
                setVisibleLimit(60);
              }}
              className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono-num text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="ledger-date-to"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              To Date
            </label>
            <input
              id="ledger-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setMonthFilter('all');
                setVisibleLimit(60);
              }}
              className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono-num text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="ledger-month-select"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Quick Month
            </label>
            <select
              id="ledger-month-select"
              aria-label="Filter by month"
              value={monthFilter}
              onChange={(e) => {
                setMonthFilter(e.target.value);
                setDateFrom('');
                setDateTo('');
                setVisibleLimit(60);
              }}
              className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="all">All ({months.length}m)</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="ledger-currency-filter"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Currency
            </label>
            <select
              id="ledger-currency-filter"
              aria-label="Filter by currency"
              value={currencyFilter}
              onChange={(e) => {
                setCurrencyFilter(e.target.value as 'all' | CurrencyCode);
                setVisibleLimit(60);
              }}
              className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="all">All ({presentCurrencies.length})</option>
              {presentCurrencies.map((code) => (
                <option key={code} value={code}>
                  {CURRENCY_CONFIG[code].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 3: Smart Search Auto-Tag Toggles (Tax Deductible / Expense Claimable) */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">
              <Sparkles className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
              Smart Tags
            </span>
            <div
              className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto max-w-full"
              role="group"
              aria-label="Filter by Smart Search auto-tags"
            >
              {(
                [
                  { id: 'all', label: 'All Ledger', count: null },
                  {
                    id: 'tax_deductible',
                    label: 'Tax Deductible',
                    count: smartTagSummary.taxDeductibleCount,
                  },
                  {
                    id: 'expense_claimable',
                    label: 'Expense Claimable',
                    count: smartTagSummary.expenseClaimableCount,
                  },
                  {
                    id: 'any_smart_tag',
                    label: 'Either Tag',
                    count: smartTagSummary.eitherTagCount,
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={smartTagFilter === opt.id}
                  onClick={() => {
                    setSmartTagFilter(opt.id);
                    setVisibleLimit(60);
                  }}
                  className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    smartTagFilter === opt.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                  {opt.count !== null && (
                    <span className="ml-1 font-mono-num text-[11px] text-slate-400 dark:text-slate-500">
                      ({opt.count})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Tax Deductible:{' '}
              <strong className="font-mono-num text-teal-700 dark:text-teal-400">
                {formatMoney(smartTagSummary.taxDeductibleTotal, currency, 0)}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Expense Claimable:{' '}
              <strong className="font-mono-num text-sky-700 dark:text-sky-400">
                {formatMoney(smartTagSummary.expenseClaimableTotal, currency, 0)}
              </strong>
            </span>
          </div>
        </div>

        {/* Filter Results Summary Strip */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Showing{' '}
              <strong className="font-mono-num text-slate-900 dark:text-slate-100">
                {filtered.length}
              </strong>{' '}
              of <span className="font-mono-num">{transactions.length}</span> transactions
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Outflows ({currency}):{' '}
              <strong className="font-mono-num text-slate-800 dark:text-slate-200">
                {formatMoney(filteredTotals.outflows, currency, 2)}
              </strong>
            </span>
            {filteredTotals.inflows > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Inflows ({currency}):{' '}
                  <strong className="font-mono-num text-emerald-700 dark:text-emerald-400">
                    +{formatMoney(filteredTotals.inflows, currency, 2)}
                  </strong>
                </span>
              </>
            )}
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Advanced Rules & Automated Category Rules Engine */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setRulesExpanded((v) => !v)}
            aria-expanded={rulesExpanded}
            className="flex items-center gap-2.5 text-left min-w-0 flex-1 cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">
                Advanced Rules &amp; Automation Engine
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono-num">{activeAdvancedCount}</span> active conditional rule
                {activeAdvancedCount === 1 ? '' : 's'} ·{' '}
                <span className="font-mono-num">{learnedRules.length}</span> learned merchant rules
                {liveSuggestions.length > 0 && (
                  <>
                    {' '}
                    ·{' '}
                    <span className="font-medium text-teal-700 dark:text-teal-400 font-mono-num">
                      {liveSuggestions.length} pending update
                      {liveSuggestions.length === 1 ? '' : 's'}
                    </span>
                  </>
                )}
              </p>
            </div>
          </button>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {liveSuggestions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onApplySuggestions(liveSuggestions);
                  setExportNotice(
                    `Applied ${liveSuggestions.length} automated rule update${
                      liveSuggestions.length === 1 ? '' : 's'
                    } locally.`
                  );
                  window.setTimeout(() => setExportNotice(null), 4000);
                }}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Apply All ({liveSuggestions.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRulesTab('advanced');
                setRulesExpanded((v) => !v);
              }}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <span>{rulesExpanded ? 'Hide Rules' : 'Advanced Rules'}</span>
              {rulesExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {rulesExpanded && (
          <div className="px-4 sm:px-5 pb-5 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-5">
            {/* Sub-tab Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
                role="tablist"
                aria-label="Automation rule views"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={rulesTab === 'advanced'}
                  onClick={() => setRulesTab('advanced')}
                  className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    rulesTab === 'advanced'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Advanced Conditional Rules ({advancedRules.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={rulesTab === 'learned'}
                  onClick={() => setRulesTab('learned')}
                  className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    rulesTab === 'learned'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Learned Merchant Rules ({learnedRules.length})
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Advanced conditional rules run first, both live here and on every new statement import.
              </p>
            </div>

            {rulesTab === 'advanced' ? (
              <div className="space-y-5">
                {/* Conditional Rule Builder Form */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Create Conditional Rule (IF / AND → THEN)
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Example: If merchant contains &ldquo;Tesco&rdquo; and amount &gt; {currencySymbol}50, mark as Essential
                    </p>
                  </div>

                  {/* IF Conditions Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
                    <div className="lg:col-span-4">
                      <label
                        htmlFor="adv-rule-merchant"
                        className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                      >
                        IF Merchant or Description contains
                      </label>
                      <input
                        id="adv-rule-merchant"
                        type="text"
                        value={ruleMerchant}
                        onChange={(e) => setRuleMerchant(e.target.value)}
                        placeholder="e.g. Tesco, Amazon, Uber, Airbnb"
                        className="w-full min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                      />
                    </div>

                    <div className="lg:col-span-3">
                      <label
                        htmlFor="adv-rule-operator"
                        className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                      >
                        AND Amount Condition
                      </label>
                      <select
                        id="adv-rule-operator"
                        value={ruleOperator}
                        onChange={(e) => setRuleOperator(e.target.value as AmountOperator)}
                        className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="any">Any amount</option>
                        <option value="gt">Greater than (&gt;)</option>
                        <option value="gte">At least (&gt;=)</option>
                        <option value="lt">Less than (&lt;)</option>
                        <option value="lte">At most (&lt;=)</option>
                        <option value="between">Between (min – max)</option>
                      </select>
                    </div>

                    {ruleOperator !== 'any' && (
                      <div className={ruleOperator === 'between' ? 'lg:col-span-1' : 'lg:col-span-2'}>
                        <label
                          htmlFor="adv-rule-amount"
                          className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                        >
                          {ruleOperator === 'between' ? 'Min' : `Amount (${ruleCurrency === 'any' ? currencySymbol : CURRENCY_CONFIG[ruleCurrency].symbol})`}
                        </label>
                        <input
                          id="adv-rule-amount"
                          type="number"
                          min="0"
                          step="0.01"
                          value={ruleAmount}
                          onChange={(e) => setRuleAmount(e.target.value)}
                          placeholder="50"
                          className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    )}

                    {ruleOperator === 'between' && (
                      <div className="lg:col-span-1">
                        <label
                          htmlFor="adv-rule-amount-max"
                          className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                        >
                          Max
                        </label>
                        <input
                          id="adv-rule-amount-max"
                          type="number"
                          min="0"
                          step="0.01"
                          value={ruleAmountMax}
                          onChange={(e) => setRuleAmountMax(e.target.value)}
                          placeholder="200"
                          className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    )}

                    <div className={ruleOperator === 'any' ? 'lg:col-span-5' : 'lg:col-span-3'}>
                      <label
                        htmlFor="adv-rule-currency"
                        className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                      >
                        AND Currency
                      </label>
                      <select
                        id="adv-rule-currency"
                        value={ruleCurrency}
                        onChange={(e) => setRuleCurrency(e.target.value as CurrencyCode | 'any')}
                        className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="any">Any currency (converted to {currency})</option>
                        {CURRENCY_CODES.map((code) => (
                          <option key={code} value={code}>
                            Only {CURRENCY_CONFIG[code].label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* THEN Actions Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
                    <div className="lg:col-span-3">
                      <label
                        htmlFor="adv-rule-class"
                        className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                      >
                        THEN Mark Classification
                      </label>
                      <select
                        id="adv-rule-class"
                        value={ruleTargetClass}
                        onChange={(e) => setRuleTargetClass(e.target.value as SpendingClass)}
                        className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-slate-100"
                      >
                        <option value="essential">Essential</option>
                        <option value="non-essential">Non-Essential</option>
                        <option value="savings">ISA / Savings</option>
                        <option value="income">Income</option>
                      </select>
                    </div>

                    <div className="lg:col-span-4">
                      <label
                        htmlFor="adv-rule-category"
                        className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                      >
                        AND Set Category (optional)
                      </label>
                      <select
                        id="adv-rule-category"
                        value={ruleTargetCategory}
                        onChange={(e) => setRuleTargetCategory(e.target.value as CategoryId | '')}
                        className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="">Keep transaction&rsquo;s current category</option>
                        {Object.values(CATEGORIES).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="lg:col-span-5">
                      <label
                        htmlFor="adv-rule-name"
                        className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
                      >
                        Rule Name (optional)
                      </label>
                      <input
                        id="adv-rule-name"
                        type="text"
                        value={ruleName}
                        onChange={(e) => setRuleName(e.target.value)}
                        placeholder="Auto-named from condition if left blank"
                        className="w-full min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                      />
                    </div>
                  </div>

                  {/* Live Preview + Action Buttons */}
                  <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      {draftRule ? (
                        <span>
                          Live preview:{' '}
                          <strong className="font-mono-num text-slate-900 dark:text-slate-100">
                            {draftPreviewStats.matched}
                          </strong>{' '}
                          transaction{draftPreviewStats.matched === 1 ? '' : 's'} match ·{' '}
                          <strong className="font-mono-num text-teal-700 dark:text-teal-400">
                            {draftPreviewStats.wouldUpdate}
                          </strong>{' '}
                          would be updated now
                        </span>
                      ) : (
                        <span>Enter a merchant keyword, amount threshold, or currency filter above.</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!draftRule}
                        onClick={() => handleSaveAdvancedRule(false)}
                        className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Save Rule
                      </button>
                      <button
                        type="button"
                        disabled={!draftRule}
                        onClick={() => handleSaveAdvancedRule(true)}
                        className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-xs font-medium transition-colors cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Save &amp; Apply Now
                      </button>
                    </div>
                  </div>
                </div>

                {/* Active Conditional Rules List */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Your Conditional Rules ({advancedRules.length})
                  </p>
                  {advancedRules.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      No conditional rules yet. Create one above to automatically tag expenses by merchant, amount, or currency.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-800">
                      {advancedRules.map((rule) => {
                        const stats = ruleMatchCounts.get(rule.id) ?? { matched: 0, pending: 0 };
                        const condText = describeAdvancedRuleCondition(rule, currency);
                        const actionLabel =
                          rule.targetSpendingClass === 'essential'
                            ? 'Essential'
                            : rule.targetSpendingClass === 'non-essential'
                              ? 'Non-Essential'
                              : rule.targetSpendingClass === 'savings'
                                ? 'ISA / Savings'
                                : 'Income';

                        return (
                          <div
                            key={rule.id}
                            className={`px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                              rule.enabled ? '' : 'opacity-60'
                            }`}
                          >
                            <div className="min-w-0 space-y-0.5">
                              <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {rule.name}
                              </p>
                              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                IF {condText} → Mark as{' '}
                                <span
                                  className={
                                    rule.targetSpendingClass === 'non-essential'
                                      ? 'font-medium text-amber-700 dark:text-amber-400'
                                      : 'font-medium text-teal-700 dark:text-teal-400'
                                  }
                                >
                                  {actionLabel}
                                </span>
                                {rule.targetCategory
                                  ? ` · ${CATEGORIES[rule.targetCategory].label}`
                                  : ''}
                              </p>
                              <p className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                                {stats.matched} matched in ledger
                                {stats.pending > 0 ? ` · ${stats.pending} ready to update` : ' · Up to date'}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => onToggleAdvancedRule(rule.id)}
                                className={`min-h-[32px] px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors cursor-pointer ${
                                  rule.enabled
                                    ? 'border-teal-600/40 text-teal-700 dark:text-teal-400 bg-teal-50/50 dark:bg-teal-950/30'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {rule.enabled ? 'Active' : 'Paused'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRunSingleAdvancedRule(rule)}
                                className="min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                <Play className="w-3 h-3" />
                                Run
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteAdvancedRule(rule.id)}
                                aria-label={`Delete conditional rule ${rule.name}`}
                                className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-md text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Changing any transaction&rsquo;s category or Essential/Non-Essential label below automatically saves a local merchant rule for future bank statement uploads.
                </p>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Saved &amp; Learned Merchant Rules ({learnedRules.length})
                  </p>
                  {learnedRules.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      No rules learned yet. Reclassify any merchant in the table below to teach your first rule.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                      {learnedRules.slice(0, 16).map((rule) => (
                        <div
                          key={rule.id}
                          className="px-3 py-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                              &ldquo;{rule.matchPattern}&rdquo; → {CATEGORIES[rule.category].label}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {rule.source === 'manual'
                                ? 'Saved user label'
                                : rule.source === 'recurring_pattern'
                                  ? 'Recurring pattern'
                                  : 'Historical consistency'}{' '}
                              · {rule.confidence}% · {rule.spendingClass}
                            </p>
                          </div>
                          {rule.source === 'manual' && (
                            <button
                              type="button"
                              onClick={() => onDeleteRule(rule.id)}
                              aria-label={`Remove saved rule for ${rule.matchPattern}`}
                              className="min-w-[30px] min-h-[30px] flex items-center justify-center rounded-md text-slate-400 hover:text-red-600 hover:bg-slate-200/60 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pending Automated Suggestions (from Advanced Rules + Learned Rules) */}
            {liveSuggestions.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <Sparkles className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                  <span>Pending Rule Suggestions ({liveSuggestions.length})</span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200/80 dark:border-slate-800 px-3 max-h-48 overflow-y-auto">
                  {liveSuggestions.slice(0, 20).map((s) => (
                    <div
                      key={s.transactionId}
                      className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {s.merchant}{' '}
                          <span className="font-normal font-mono-num text-slate-500">
                            ({s.date} · {formatMoney(Math.abs(s.amount), currency, 2)})
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {CATEGORIES[s.currentCategory].label} →{' '}
                          <span className="text-teal-700 dark:text-teal-400 font-medium">
                            {CATEGORIES[s.suggestedCategory].label} ({s.suggestedClass})
                          </span>{' '}
                          · {s.reason}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onApplySuggestions([s])}
                        className="min-h-[30px] px-2.5 py-1 rounded-md border border-teal-600/40 text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 text-xs font-medium shrink-0 cursor-pointer"
                      >
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* High-Density Ledger Table (Desktop) + Touch List (Mobile) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No transactions match your current filter.
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4 w-28">Date</th>
                    <th className="py-3 px-4">Merchant &amp; Description</th>
                    <th className="py-3 px-4 w-52">Category</th>
                    <th className="py-3 px-4 w-32">Classification</th>
                    <th className="py-3 px-4 w-24">Curr.</th>
                    <th className="py-3 px-4 w-36 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                  {filtered.slice(0, visibleLimit).map((tx) => {
                    const txCurr = tx.currency ?? currency;
                    const isForeign = txCurr !== currency;
                    const convertedAmt = getTransactionDisplayAmount(tx, currency, exchangeRates);
                    const txSmartTags = smartTagSummary.byTransactionId[tx.id] ?? [];
                    return (
                      <tr
                        key={tx.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2.5 px-4 font-mono-num text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {tx.date}
                        </td>
                        <td className="py-2.5 px-4 max-w-xs">
                          <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {tx.merchant}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {tx.description}
                          </p>
                          {txSmartTags.length > 0 && (
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px]">
                              {txSmartTags.map((tag, idx) => (
                                <React.Fragment key={tag.tag}>
                                  {idx > 0 && (
                                    <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                                      ·
                                    </span>
                                  )}
                                  <span
                                    title={`Auto-tagged: ${tag.reason}`}
                                    className={
                                      tag.tag === 'tax_deductible'
                                        ? 'font-medium text-teal-700 dark:text-teal-400'
                                        : 'font-medium text-sky-700 dark:text-sky-400'
                                    }
                                  >
                                    {tag.label}
                                  </span>
                                </React.Fragment>
                              ))}
                            </p>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <select
                            aria-label={`Category for ${tx.merchant}`}
                            value={tx.category}
                            onChange={(e) => {
                              const nextCat = e.target.value as CategoryId;
                              onUpdateTransaction(tx.id, {
                                category: nextCat,
                                spendingClass: CATEGORIES[nextCat].defaultClass,
                              });
                            }}
                            className="w-full py-1 px-2 rounded-md border border-transparent hover:border-slate-200 dark:hover:border-slate-700 bg-transparent text-xs text-slate-700 dark:text-slate-300 focus:border-teal-600 focus:outline-none cursor-pointer"
                          >
                            {Object.values(CATEGORIES).map((c) => (
                              <option
                                key={c.id}
                                value={c.id}
                                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                              >
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-4">
                          {tx.spendingClass === 'income' || tx.spendingClass === 'savings' ? (
                            <span className="text-xs font-medium text-teal-700 dark:text-teal-400">
                              {tx.spendingClass === 'income' ? 'Income' : 'ISA / Savings'}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleEssentialClass(tx)}
                              className={`text-xs font-medium hover:underline cursor-pointer ${
                                tx.spendingClass === 'essential'
                                  ? 'text-slate-700 dark:text-slate-300'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                              title="Click to switch between Essential and Non-Essential"
                            >
                              {tx.spendingClass === 'essential' ? 'Essential' : 'Non-Essential'}
                            </button>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <select
                            aria-label={`Currency for ${tx.merchant}`}
                            value={txCurr}
                            onChange={(e) =>
                              onUpdateTransaction(tx.id, {
                                currency: e.target.value as CurrencyCode,
                              })
                            }
                            className={`py-1 px-1.5 rounded-md border border-transparent hover:border-slate-200 dark:hover:border-slate-700 bg-transparent text-xs font-mono-num focus:border-teal-600 focus:outline-none cursor-pointer ${
                              isForeign
                                ? 'text-teal-700 dark:text-teal-400 font-semibold'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {CURRENCY_CODES.map((code) => (
                              <option
                                key={code}
                                value={code}
                                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                              >
                                {code}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono-num whitespace-nowrap">
                          <p
                            className={`font-medium ${
                              tx.amount > 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {tx.amount > 0 ? '+' : ''}
                            {formatMoney(tx.amount, txCurr, 2)}
                          </p>
                          {isForeign && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              ≈ {convertedAmt > 0 ? '+' : ''}
                              {formatMoney(convertedAmt, currency, 2)}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Touch Rows */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.slice(0, visibleLimit).map((tx) => {
                const txCurr = tx.currency ?? currency;
                const isForeign = txCurr !== currency;
                const convertedAmt = getTransactionDisplayAmount(tx, currency, exchangeRates);
                const txSmartTags = smartTagSummary.byTransactionId[tx.id] ?? [];
                return (
                  <div
                    key={tx.id}
                    className="p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {tx.merchant}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {tx.date} · {CATEGORIES[tx.category].label}
                        {isForeign ? ` · ${txCurr}` : ''}
                      </p>
                      {txSmartTags.length > 0 && (
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px]">
                          {txSmartTags.map((tag, idx) => (
                            <React.Fragment key={tag.tag}>
                              {idx > 0 && (
                                <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                                  ·
                                </span>
                              )}
                              <span
                                title={`Auto-tagged: ${tag.reason}`}
                                className={
                                  tag.tag === 'tax_deductible'
                                    ? 'font-medium text-teal-700 dark:text-teal-400'
                                    : 'font-medium text-sky-700 dark:text-sky-400'
                                }
                              >
                                {tag.label}
                              </span>
                            </React.Fragment>
                          ))}
                        </p>
                      )}
                      {tx.spendingClass !== 'income' && tx.spendingClass !== 'savings' && (
                        <button
                          type="button"
                          onClick={() => toggleEssentialClass(tx)}
                          className={`mt-1 text-xs font-medium underline-offset-2 hover:underline cursor-pointer ${
                            tx.spendingClass === 'essential'
                              ? 'text-slate-600 dark:text-slate-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {tx.spendingClass === 'essential'
                            ? 'Essential (tap to change)'
                            : 'Non-Essential (tap to change)'}
                        </button>
                      )}
                    </div>
                    <div className="text-right font-mono-num shrink-0">
                      <p
                        className={`text-sm font-semibold ${
                          tx.amount > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {tx.amount > 0 ? '+' : ''}
                        {formatMoney(tx.amount, txCurr, 2)}
                      </p>
                      {isForeign && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          ≈ {convertedAmt > 0 ? '+' : ''}
                          {formatMoney(convertedAmt, currency, 2)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {filtered.length > visibleLimit && (
              <div className="p-4 border-t border-slate-100 dark:border-slate-800 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((n) => n + 80)}
                  className="min-h-[40px] px-4 py-2 rounded-lg text-xs font-medium text-teal-700 dark:text-teal-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Show more transactions ({filtered.length - visibleLimit} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

