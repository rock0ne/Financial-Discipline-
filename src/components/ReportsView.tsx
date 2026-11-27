import React, { useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CATEGORIES,
  formatMoney,
  getTransactionDisplayAmount,
  type CategoryId,
  type CurrencyCode,
  type DebtAccount,
  type ExchangeRateTable,
  type IsaPlannerSettings,
  type Transaction,
} from '../types/finance';
import {
  computeTopMerchantsByCategoryOverTime,
  computeTwentyFourMonthSpendingTrend,
  formatMonthLabel,
  type AnalyticsResult,
  type TwentyFourMonthTrendPoint,
} from '../utils/analyticsEngine';
import {
  buildMonthlyReportData,
  formatQuarterLabel,
  generateMonthlyPdfDocument,
  getAvailableQuarters,
  printMonthlyPdfReport,
  type PdfPaperFormat,
  type ReportCadence,
} from '../utils/pdfReportGenerator';
import { exportTransactionsToCsv } from '../utils/statementParser';
import { saveCsvDocument, savePdfDocument } from '../utils/documentSave';

interface ReportsViewProps {
  transactions: Transaction[];
  analytics: AnalyticsResult;
  categoryCaps?: Partial<Record<CategoryId, number>>;
  isaSettings: IsaPlannerSettings;
  debts?: DebtAccount[];
  currency: CurrencyCode;
  exchangeRates?: Partial<ExchangeRateTable>;
  onOpenImport: () => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  transactions,
  analytics,
  categoryCaps,
  isaSettings,
  debts = [],
  currency,
  exchangeRates,
  onOpenImport,
}) => {
  const availableMonths = useMemo(() => {
    return Array.from(new Set(transactions.map((t) => t.date.slice(0, 7))))
      .sort()
      .reverse();
  }, [transactions]);

  const availableQuarters = useMemo(
    () => getAvailableQuarters(transactions),
    [transactions]
  );

  const [reportCadence, setReportCadence] = useState<ReportCadence>('monthly');
  const [selectedPeriod, setSelectedPeriod] = useState<string>(
    () => availableMonths[0] ?? 'summary'
  );
  const [paperFormat, setPaperFormat] = useState<PdfPaperFormat>('a4');
  const [includeAnalyticalFindings, setIncludeAnalyticalFindings] = useState(true);
  const [includeLedgerSummary, setIncludeLedgerSummary] = useState(true);
  const [includeCategoryBreakdown, setIncludeCategoryBreakdown] = useState(true);
  const [includeRecommendations, setIncludeRecommendations] = useState(true);
  const [includeSubscriptions, setIncludeSubscriptions] = useState(true);
  const [includeSavingsVsDebt, setIncludeSavingsVsDebt] = useState(true);
  const [includeTopTransactions, setIncludeTopTransactions] = useState(true);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [merchantCategoryFilter, setMerchantCategoryFilter] = useState<CategoryId | 'all'>('all');
  const [merchantChartMode, setMerchantChartMode] = useState<'stacked' | 'grouped'>('stacked');
  const [trendChartMode, setTrendChartMode] = useState<'total' | 'split'>('total');

  const applyExportPreset = (
    preset: 'current_month_projections' | 'full' | 'executive' | 'ledger'
  ) => {
    if (preset === 'current_month_projections') {
      setReportCadence('monthly');
      setSelectedPeriod(availableMonths[0] ?? 'summary');
      setIncludeAnalyticalFindings(true);
      setIncludeLedgerSummary(false);
      setIncludeCategoryBreakdown(true);
      setIncludeRecommendations(true);
      setIncludeSubscriptions(true);
      setIncludeSavingsVsDebt(debts.some((d) => d.balance > 0));
      setIncludeTopTransactions(true);
    } else if (preset === 'full') {
      setIncludeAnalyticalFindings(true);
      setIncludeLedgerSummary(true);
      setIncludeCategoryBreakdown(true);
      setIncludeRecommendations(true);
      setIncludeSubscriptions(true);
      setIncludeSavingsVsDebt(true);
      setIncludeTopTransactions(true);
    } else if (preset === 'executive') {
      setIncludeAnalyticalFindings(true);
      setIncludeLedgerSummary(false);
      setIncludeCategoryBreakdown(true);
      setIncludeRecommendations(true);
      setIncludeSubscriptions(false);
      setIncludeSavingsVsDebt(true);
      setIncludeTopTransactions(false);
    } else {
      setIncludeAnalyticalFindings(false);
      setIncludeLedgerSummary(true);
      setIncludeCategoryBreakdown(true);
      setIncludeRecommendations(false);
      setIncludeSubscriptions(false);
      setIncludeSavingsVsDebt(false);
      setIncludeTopTransactions(true);
    }
  };

  const formatPrecise = (amount: number, forcePence = false) => {
    const needsPence =
      forcePence ||
      (amount !== 0 && Math.abs(amount) < 1) ||
      (Math.abs(amount - Math.round(amount)) >= 0.005 && Math.abs(amount) < 100);
    return formatMoney(amount, currency, needsPence ? 2 : 0);
  };

  const handleCadenceChange = (nextCadence: ReportCadence) => {
    setReportCadence(nextCadence);
    if (nextCadence === 'quarterly') {
      setSelectedPeriod(availableQuarters[0] ?? 'summary');
    } else {
      setSelectedPeriod(availableMonths[0] ?? 'summary');
    }
  };

  // Keep selected period valid if transactions or cadence change
  const effectivePeriod =
    reportCadence === 'quarterly'
      ? availableQuarters.includes(selectedPeriod)
        ? selectedPeriod
        : (availableQuarters[0] ?? 'summary')
      : selectedPeriod === 'summary' || availableMonths.includes(selectedPeriod)
        ? selectedPeriod
        : (availableMonths[0] ?? 'summary');

  const reportData = useMemo(
    () =>
      buildMonthlyReportData(
        transactions,
        analytics,
        categoryCaps,
        isaSettings,
        effectivePeriod,
        currency,
        exchangeRates,
        debts
      ),
    [
      transactions,
      analytics,
      categoryCaps,
      isaSettings,
      effectivePeriod,
      currency,
      exchangeRates,
      debts,
    ]
  );

  const buildPdfOptions = () => ({
    currency,
    exchangeRates,
    paperFormat,
    includeAnalyticalFindings,
    includeLedgerSummary,
    includeCategoryBreakdown,
    includeRecommendations,
    includeSubscriptions,
    includeSavingsVsDebt,
    includeTopTransactions,
  });

  const topMerchantsTrend = useMemo(
    () =>
      computeTopMerchantsByCategoryOverTime(
        transactions,
        merchantCategoryFilter,
        currency,
        exchangeRates,
        5,
        12
      ),
    [transactions, merchantCategoryFilter, currency, exchangeRates]
  );

  const yearlySpendingTrend = useMemo(
    () => computeTwentyFourMonthSpendingTrend(transactions, currency, exchangeRates, 24),
    [transactions, currency, exchangeRates]
  );

  const merchantLabelLookup = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of topMerchantsTrend.merchants) {
      map[m.key] =
        merchantCategoryFilter === 'all' && m.key !== 'm_other'
          ? `${m.merchant} (${m.categoryLabel})`
          : m.merchant;
    }
    return map;
  }, [topMerchantsTrend.merchants, merchantCategoryFilter]);

  const handleDownloadPdf = async () => {
    try {
      const doc = generateMonthlyPdfDocument(reportData, buildPdfOptions());
      const safePeriod = reportData.periodKey.replace(/[^a-zA-Z0-9_-]/g, '_');
      const result = await savePdfDocument(doc, `clearledger_analytics_ledger_${safePeriod}.pdf`);
      setStatusNotice(
        result.status === 'saved'
          ? `Saved ${result.fileName} to your chosen location.`
          : result.status === 'cancelled'
            ? 'PDF save cancelled; no file was written.'
            : `Download requested for ${result.fileName}; check your Downloads.`
      );
    } catch (error) {
      setStatusNotice(`PDF save failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    window.setTimeout(() => setStatusNotice(null), 5000);
  };

  const handleExportLedgerCsv = async () => {
    const rows =
      reportData.ledgerTransactions.length > 0
        ? reportData.ledgerTransactions
        : transactions;
    if (rows.length === 0) return;
    try {
      const csv = exportTransactionsToCsv(rows, currency, {
        exchangeRates,
        smartTagsByTxId: reportData.smartTags.byTransactionId,
      });
      const safePeriod = reportData.periodKey.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `clearledger_ledger_${safePeriod}_${new Date().toISOString().slice(0, 10)}.csv`;
      const result = await saveCsvDocument(csv, fileName);
      setStatusNotice(
        result.status === 'saved'
          ? `Saved ${rows.length} ledger transaction${rows.length === 1 ? '' : 's'} to ${result.fileName}.`
          : result.status === 'cancelled'
            ? 'CSV save cancelled; no file was written.'
            : `Download requested for ${result.fileName}; check your Downloads.`
      );
    } catch (error) {
      setStatusNotice(`CSV save failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    window.setTimeout(() => setStatusNotice(null), 5000);
  };

  const handlePrintPdf = () => {
    if (Capacitor.isNativePlatform()) {
      setStatusNotice('Use Export Printable PDF, then open the saved file in a PDF viewer to print.');
      window.setTimeout(() => setStatusNotice(null), 5000);
      return;
    }
    printMonthlyPdfReport(reportData, buildPdfOptions());
    setStatusNotice(`Prepared printable ${paperFormat.toUpperCase()} PDF document.`);
    window.setTimeout(() => setStatusNotice(null), 5000);
  };

  if (transactions.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 md:p-12 text-center max-w-2xl mx-auto my-8">
        <FileText className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          Import bank statements to generate monthly PDF reports
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
          Clearledger builds printable A4 summaries directly in your browser using jsPDF with zero server uploads.
        </p>
        <button
          type="button"
          onClick={onOpenImport}
          className="mt-6 min-h-[42px] px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium transition-colors cursor-pointer"
        >
          Import Bank Statements
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Printable Financial Reports
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Analytical findings &amp; ledger summaries via jsPDF</span>
            <span aria-hidden="true">·</span>
            <span>Zero cloud upload</span>
            <span aria-hidden="true">·</span>
            <span>{paperFormat === 'a4' ? 'A4' : 'US Letter'} printable PDF</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleExportLedgerCsv}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
            Export Ledger CSV
          </button>
          <button
            type="button"
            onClick={handlePrintPdf}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print PDF
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Printable PDF
          </button>
        </div>
      </div>

      {statusNotice && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 flex items-center gap-2 text-xs font-medium text-teal-900 dark:text-teal-200"
        >
          <CheckCircle2 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      {/* Report Configuration Toolbar */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Monthly / Quarterly Cadence Segmented Toggle */}
            <div
              className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
              role="group"
              aria-label="Report cadence"
            >
              <button
                type="button"
                onClick={() => handleCadenceChange('monthly')}
                aria-pressed={reportCadence === 'monthly'}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  reportCadence === 'monthly'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => handleCadenceChange('quarterly')}
                aria-pressed={reportCadence === 'quarterly'}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  reportCadence === 'quarterly'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Quarterly
              </button>
            </div>

            <label
              htmlFor="report-period-select"
              className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap"
            >
              {reportCadence === 'quarterly' ? 'Quarter' : 'Report Period'}
            </label>
            <select
              id="report-period-select"
              value={effectivePeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-medium text-slate-900 dark:text-slate-100"
            >
              {reportCadence === 'quarterly' ? (
                availableQuarters.map((qk) => (
                  <option key={qk} value={qk}>
                    {formatQuarterLabel(qk)}
                  </option>
                ))
              ) : (
                <>
                  {availableMonths.map((mk) => (
                    <option key={mk} value={mk}>
                      {formatMonthLabel(mk)} ({mk})
                    </option>
                  ))}
                  <option value="summary">
                    Full Period Monthly Average ({analytics.monthCount} months)
                  </option>
                </>
              )}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="report-paper-select"
              className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap"
            >
              Paper
            </label>
            <select
              id="report-paper-select"
              value={paperFormat}
              onChange={(e) => setPaperFormat(e.target.value as PdfPaperFormat)}
              className="min-h-[38px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-900 dark:text-slate-100"
            >
              <option value="a4">A4 (210 × 297 mm)</option>
              <option value="letter">US Letter (8.5 × 11 in)</option>
            </select>

            <div className="inline-flex flex-wrap items-center gap-1.5 pl-2 border-l border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">Presets:</span>
              <button
                type="button"
                onClick={() => applyExportPreset('current_month_projections')}
                className="min-h-[32px] px-2.5 py-1 rounded-md border border-teal-600/40 bg-teal-50/60 dark:bg-teal-950/40 text-xs font-medium text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/70 transition-colors cursor-pointer"
              >
                Latest Imported Month &amp; Projections
              </button>
              <button
                type="button"
                onClick={() => applyExportPreset('full')}
                className="min-h-[32px] px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Full Pack
              </button>
              <button
                type="button"
                onClick={() => applyExportPreset('executive')}
                className="min-h-[32px] px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Executive Brief
              </button>
              <button
                type="button"
                onClick={() => applyExportPreset('ledger')}
                className="min-h-[32px] px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Ledger &amp; Tax
              </button>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-700 dark:text-slate-300">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeAnalyticalFindings}
              onChange={(e) => setIncludeAnalyticalFindings(e.target.checked)}
              className="w-4 h-4 rounded accent-teal-700"
            />
            <span>Analytical Findings &amp; Forecast</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeCategoryBreakdown}
              onChange={(e) => setIncludeCategoryBreakdown(e.target.checked)}
              className="w-4 h-4 rounded accent-teal-700"
            />
            <span>Category Breakdown &amp; Caps</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeLedgerSummary}
              onChange={(e) => setIncludeLedgerSummary(e.target.checked)}
              className="w-4 h-4 rounded accent-teal-700"
            />
            <span>Ledger &amp; Smart-Tag Summary</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeRecommendations}
              onChange={(e) => setIncludeRecommendations(e.target.checked)}
              className="w-4 h-4 rounded accent-teal-700"
            />
            <span>Savings Recommendations</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSubscriptions}
              onChange={(e) => setIncludeSubscriptions(e.target.checked)}
              className="w-4 h-4 rounded accent-teal-700"
            />
            <span>Subscriptions</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSavingsVsDebt}
              onChange={(e) => setIncludeSavingsVsDebt(e.target.checked)}
              className="w-4 h-4 rounded accent-teal-700"
            />
            <span>Savings vs. Debt Payoff</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeTopTransactions}
              onChange={(e) => setIncludeTopTransactions(e.target.checked)}
              className="w-4 h-4 rounded accent-teal-700"
            />
            <span>Largest Expenses</span>
          </label>
        </div>
      </section>

      {/* 24-Month Yearly Spending Trend Line Chart */}
      <section
        aria-label="24-month yearly spending trend"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                24-Month Yearly Spending Trend
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {yearlySpendingTrend.horizonLabel} ·{' '}
              <span className="font-mono-num">
                {yearlySpendingTrend.observedMonthsCount} of 24
              </span>{' '}
              months recorded · Total monthly expenditure trajectory
            </p>
          </div>

          <div
            className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start lg:self-auto"
            role="group"
            aria-label="24-month trend line series mode"
          >
            <button
              type="button"
              onClick={() => setTrendChartMode('total')}
              aria-pressed={trendChartMode === 'total'}
              className={`min-h-[30px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                trendChartMode === 'total'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Total + 3M Avg
            </button>
            <button
              type="button"
              onClick={() => setTrendChartMode('split')}
              aria-pressed={trendChartMode === 'split'}
              className={`min-h-[30px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                trendChartMode === 'split'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Essential vs. Discretionary
            </button>
          </div>
        </div>

        {/* 24-Month Health Summary Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              24M Recorded Expenditure
            </p>
            <p className="mt-1 text-lg font-semibold font-mono-num text-slate-900 dark:text-slate-100">
              {formatMoney(yearlySpendingTrend.totalExpenditure, currency, 2)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
              Across {yearlySpendingTrend.observedMonthsCount} month
              {yearlySpendingTrend.observedMonthsCount === 1 ? '' : 's'}
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Monthly Average
            </p>
            <p className="mt-1 text-lg font-semibold font-mono-num text-slate-900 dark:text-slate-100">
              {formatMoney(yearlySpendingTrend.monthlyAverage, currency, 2)}
              <span className="text-xs font-normal text-slate-500">/mo</span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Shown as dashed reference line
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Year-over-Year Pace
            </p>
            {yearlySpendingTrend.yoyDeltaPct !== null ? (
              <>
                <p
                  className={`mt-1 text-lg font-semibold font-mono-num ${
                    yearlySpendingTrend.yoyDeltaPct <= 0
                      ? 'text-teal-700 dark:text-teal-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {yearlySpendingTrend.yoyDeltaPct > 0 ? '+' : ''}
                  {yearlySpendingTrend.yoyDeltaPct.toFixed(1)}% YoY
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                  {formatMoney(yearlySpendingTrend.priorYearAvg ?? 0, currency)}/mo →{' '}
                  {formatMoney(yearlySpendingTrend.recentYearAvg ?? 0, currency)}/mo
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-lg font-semibold font-mono-num text-slate-700 dark:text-slate-300">
                  {yearlySpendingTrend.observedMonthsCount}m history
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Import 13+ months for YoY comparison
                </p>
              </>
            )}
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Peak vs. Lowest Month
            </p>
            {yearlySpendingTrend.peakMonth && yearlySpendingTrend.lowestMonth ? (
              <>
                <p className="mt-1 text-sm font-semibold font-mono-num text-slate-900 dark:text-slate-100">
                  High: {formatMoney(yearlySpendingTrend.peakMonth.amount, currency)} (
                  {yearlySpendingTrend.peakMonth.label})
                </p>
                <p className="mt-0.5 text-[11px] font-mono-num text-teal-700 dark:text-teal-400">
                  Low: {formatMoney(yearlySpendingTrend.lowestMonth.amount, currency)} (
                  {yearlySpendingTrend.lowestMonth.label})
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-400">—</p>
            )}
          </div>
        </div>

        {/* 24-Month Interactive Line Chart */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-end gap-4 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-teal-700 dark:bg-teal-400 inline-block" />
              Total Monthly Spend
            </span>
            {trendChartMode === 'total' ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-500 inline-block" />
                3-Month Moving Avg
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-sky-600 inline-block" />
                  Essential
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-amber-500 inline-block" />
                  Non-Essential
                </span>
              </>
            )}
          </div>

          <div className="w-full h-[280px] sm:h-[310px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={yearlySpendingTrend.points}
                margin={{ top: 10, right: 12, left: -4, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#cbd5e1"
                  opacity={0.35}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={22}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatMoney(Number(v), currency)}
                />
                {yearlySpendingTrend.monthlyAverage > 0 && (
                  <ReferenceLine
                    y={yearlySpendingTrend.monthlyAverage}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    strokeOpacity={0.75}
                  />
                )}
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const pt = payload[0].payload as TwentyFourMonthTrendPoint;
                    if (!pt.hasData || pt.totalSpending === null) {
                      return (
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-md text-xs">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {pt.label}
                          </p>
                          <p className="text-slate-500 dark:text-slate-400">
                            No statement data imported for this month
                          </p>
                        </div>
                      );
                    }
                    return (
                      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 shadow-md text-xs space-y-1">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {pt.label} ({pt.monthKey})
                        </p>
                        <div className="flex items-center justify-between gap-5 font-mono-num font-semibold">
                          <span className="text-teal-700 dark:text-teal-400">Total Spend:</span>
                          <span className="text-slate-900 dark:text-slate-100">
                            {formatMoney(pt.totalSpending, currency, 2)}
                          </span>
                        </div>
                        {pt.essential !== null && (
                          <div className="flex items-center justify-between gap-5 font-mono-num">
                            <span className="text-sky-700 dark:text-sky-400">Essential:</span>
                            <span className="text-slate-700 dark:text-slate-300">
                              {formatMoney(pt.essential, currency, 2)}
                            </span>
                          </div>
                        )}
                        {pt.nonEssential !== null && (
                          <div className="flex items-center justify-between gap-5 font-mono-num">
                            <span className="text-amber-700 dark:text-amber-400">Non-Essential:</span>
                            <span className="text-slate-700 dark:text-slate-300">
                              {formatMoney(pt.nonEssential, currency, 2)}
                            </span>
                          </div>
                        )}
                        {pt.rolling3mAvg !== null && (
                          <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-5 font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                            <span>3M Moving Avg:</span>
                            <span>{formatMoney(pt.rolling3mAvg, currency, 2)}</span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="totalSpending"
                  name="Total Monthly Expenditure"
                  stroke="#0f766e"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#0f766e', strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
                {trendChartMode === 'total' ? (
                  <Line
                    type="monotone"
                    dataKey="rolling3mAvg"
                    name="3-Month Moving Avg"
                    stroke="#64748b"
                    strokeWidth={1.75}
                    strokeDasharray="5 4"
                    dot={false}
                    connectNulls={false}
                  />
                ) : (
                  <>
                    <Line
                      type="monotone"
                      dataKey="essential"
                      name="Essential"
                      stroke="#0284c7"
                      strokeWidth={1.8}
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="nonEssential"
                      name="Non-Essential"
                      stroke="#f59e0b"
                      strokeWidth={1.8}
                      dot={false}
                      connectNulls={false}
                    />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Top Spending Merchants by Category Over Time (Interactive Bar Chart) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Top Spending Merchants by Category Over Time
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Monthly outflow trajectory for your highest-spend merchants
              {merchantCategoryFilter === 'all'
                ? ' across all spending categories'
                : ` in ${CATEGORIES[merchantCategoryFilter]?.label ?? merchantCategoryFilter}`}
              {topMerchantsTrend.monthCount > 0
                ? ` · ${topMerchantsTrend.monthCount} month${topMerchantsTrend.monthCount === 1 ? '' : 's'} · Total ${formatMoney(topMerchantsTrend.totalSpend, currency, 2)}`
                : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label
              htmlFor="merchant-trend-category-select"
              className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap"
            >
              Category
            </label>
            <select
              id="merchant-trend-category-select"
              value={merchantCategoryFilter}
              onChange={(e) =>
                setMerchantCategoryFilter(e.target.value as CategoryId | 'all')
              }
              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-900 dark:text-slate-100"
            >
              <option value="all">All Spending Categories</option>
              {topMerchantsTrend.activeCategories.map((cat) => (
                <option key={cat.categoryId} value={cat.categoryId}>
                  {cat.label} ({formatMoney(cat.totalSpend, currency)})
                </option>
              ))}
            </select>

            <div
              className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
              role="group"
              aria-label="Bar chart layout"
            >
              <button
                type="button"
                onClick={() => setMerchantChartMode('stacked')}
                aria-pressed={merchantChartMode === 'stacked'}
                className={`min-h-[30px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  merchantChartMode === 'stacked'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Stacked
              </button>
              <button
                type="button"
                onClick={() => setMerchantChartMode('grouped')}
                aria-pressed={merchantChartMode === 'grouped'}
                className={`min-h-[30px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  merchantChartMode === 'grouped'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Grouped
              </button>
            </div>
          </div>
        </div>

        {topMerchantsTrend.months.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
            No outgoing merchant transactions found for this category.
          </p>
        ) : (
          <>
            <div className="w-full h-[280px] sm:h-[310px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topMerchantsTrend.months}
                  margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#cbd5e1"
                    opacity={0.35}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatMoney(Number(v), currency)}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#f8fafc',
                    }}
                    formatter={(value: unknown, name: unknown) => {
                      const key = String(name);
                      return [
                        formatMoney(Number(value), currency, 2),
                        merchantLabelLookup[key] ?? key,
                      ];
                    }}
                  />
                  {topMerchantsTrend.merchants.map((merchant, idx) => {
                    const isLastStacked =
                      merchantChartMode === 'stacked' &&
                      idx === topMerchantsTrend.merchants.length - 1;
                    return (
                      <Bar
                        key={merchant.key}
                        dataKey={merchant.key}
                        name={merchant.key}
                        stackId={merchantChartMode === 'stacked' ? 'merchants' : undefined}
                        fill={merchant.color}
                        radius={
                          merchantChartMode === 'grouped' || isLastStacked
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                        }
                        maxBarSize={merchantChartMode === 'stacked' ? 36 : 18}
                      />
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Merchant Legend & Breakdown Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
              {topMerchantsTrend.merchants.map((m) => (
                <div
                  key={m.key}
                  className="px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: m.color }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {m.merchant}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {m.categoryLabel} · {m.txCount} tx
                      </p>
                    </div>
                  </div>
                  <div className="text-right font-mono-num shrink-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {formatMoney(m.totalSpend, currency, 2)}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatMoney(m.monthlyAvg, currency)}/mo · {m.sharePct.toFixed(0)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Live Printable A4 Sheet Preview */}
      <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-8 lg:p-10 space-y-8">
        {/* Sheet Header */}
        <header className="pb-5 border-b-2 border-teal-700 dark:border-teal-600 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-teal-700 dark:text-teal-400">
              {reportData.isQuarterly
                ? 'Clearledger Quarterly Financial Summary'
                : 'Clearledger Monthly Financial Summary'}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {reportData.periodLabel}
            </h2>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 sm:text-right space-y-0.5">
            <p className="font-mono-num">
              {reportData.transactionCount} transactions analyzed locally
              {reportData.isQuarterly ? ` · ${reportData.monthCountRepresented} months in quarter` : ''}
            </p>
            <p className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              On-device PDF · No cloud transmission
            </p>
          </div>
        </header>

        {/* Executive KPI Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {reportData.isQuarterly
                ? 'Quarterly Income'
                : reportData.isSingleMonth
                  ? 'Monthly Income'
                  : 'Avg Monthly Income'}
            </p>
            <p className="mt-1.5 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
              {formatMoney(reportData.income, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
              {reportData.isQuarterly
                ? `${formatMoney(reportData.income / reportData.monthCountRepresented, currency)}/mo avg`
                : 'Net recorded inflows'}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {reportData.isQuarterly
                ? 'Quarterly Spending'
                : reportData.isSingleMonth
                  ? 'Total Spending'
                  : 'Avg Monthly Spending'}
            </p>
            <p className="mt-1.5 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
              {formatMoney(reportData.totalSpending, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
              {reportData.vsAverageSpendingDeltaPct !== null
                ? `${reportData.vsAverageSpendingDeltaPct >= 0 ? '+' : ''}${reportData.vsAverageSpendingDeltaPct.toFixed(1)}% vs 12M mo avg`
                : `${reportData.essentialSharePct.toFixed(0)}% essential`}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {reportData.isQuarterly ? 'Quarterly Non-Essential' : 'Non-Essential Spend'}
            </p>
            <p className="mt-1.5 text-2xl font-semibold font-mono-num text-amber-700 dark:text-amber-400">
              {formatMoney(reportData.nonEssential, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
              {reportData.nonEssentialSharePct.toFixed(1)}% of total spend
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {reportData.isQuarterly ? 'Quarterly Net Surplus' : 'Net Cash Surplus'}
            </p>
            <p
              className={`mt-1.5 text-2xl font-semibold font-mono-num ${
                reportData.netCashFlow >= 0
                  ? 'text-teal-700 dark:text-teal-400'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {formatMoney(reportData.netCashFlow, currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
              {reportData.savingsRatePct.toFixed(1)}% savings rate
            </p>
          </div>
        </div>

        {/* Essential vs Non-Essential Split Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span>
              Essential:{' '}
              <strong className="font-mono-num text-slate-900 dark:text-slate-100">
                {formatMoney(reportData.essential, currency)}
              </strong>{' '}
              ({reportData.essentialSharePct.toFixed(1)}%)
            </span>
            <span>
              Non-Essential:{' '}
              <strong className="font-mono-num text-amber-700 dark:text-amber-400">
                {formatMoney(reportData.nonEssential, currency)}
              </strong>{' '}
              ({reportData.nonEssentialSharePct.toFixed(1)}%)
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 flex">
            <div
              className="bg-slate-700 dark:bg-slate-400 h-full"
              style={{ width: `${Math.min(100, reportData.essentialSharePct)}%` }}
            />
            <div
              className="bg-amber-600 dark:bg-amber-500 h-full"
              style={{ width: `${Math.min(100, reportData.nonEssentialSharePct)}%` }}
            />
          </div>
        </div>

        {/* Analytical Findings & Next-Month Spending Forecast */}
        {includeAnalyticalFindings && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Analytical Findings &amp; Spending Trend Forecast
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                Next month: {reportData.spendingTrendProjection.nextMonthLabel} ·{' '}
                {reportData.spendingTrendProjection.monthsAnalyzed} completed baseline mo
              </span>
            </div>

            <div className="p-3.5 rounded-lg bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200/70 dark:border-teal-800/70 text-xs text-teal-900 dark:text-teal-200 leading-relaxed">
              {reportData.spendingTrendProjection.excludedPartialMonthLabel ? (
                <>
                  <strong className="font-semibold">Baseline Integrity:</strong> Partial trailing month (
                  {reportData.spendingTrendProjection.excludedPartialMonthLabel}) excluded from averages and forecasts to prevent low-bias warnings. Projected total for{' '}
                  {reportData.spendingTrendProjection.nextMonthLabel}:{' '}
                  <span className="font-mono-num font-semibold">
                    {formatMoney(reportData.spendingTrendProjection.totalProjectedNextMonth, currency, 2)}
                  </span>{' '}
                  ({reportData.spendingTrendProjection.projectedOverLimitCount} over cap ·{' '}
                  {reportData.spendingTrendProjection.varianceRiskCount} variance risk).
                </>
              ) : (
                <>
                  <strong className="font-semibold">Baseline Integrity:</strong>{' '}
                  {reportData.spendingTrendProjection.monthsAnalyzed} completed baseline month
                  {reportData.spendingTrendProjection.monthsAnalyzed === 1 ? '' : 's'} analyzed with per-category active history windows. Projected total for{' '}
                  {reportData.spendingTrendProjection.nextMonthLabel}:{' '}
                  <span className="font-mono-num font-semibold">
                    {formatMoney(reportData.spendingTrendProjection.totalProjectedNextMonth, currency, 2)}
                  </span>{' '}
                  ({reportData.spendingTrendProjection.projectedOverLimitCount} over cap ·{' '}
                  {reportData.spendingTrendProjection.varianceRiskCount} variance risk).
                </>
              )}
            </div>

            {reportData.spendingTrendProjection.categories.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-4">Category</th>
                      <th className="py-2 px-3 text-right">History</th>
                      <th className="py-2 px-3 text-right">Baseline Avg</th>
                      <th className="py-2 px-3 text-right">Projected</th>
                      <th className="py-2 px-3 text-right">Monthly Cap</th>
                      <th className="py-2 pl-3 text-right">Forecast Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {reportData.spendingTrendProjection.categories.slice(0, 12).map((row) => {
                      const forcePence =
                        row.projectedVsLimitDelta !== null &&
                        row.projectedVsLimitDelta > 0 &&
                        Math.round(row.projectedVsLimitDelta) === 0;
                      return (
                        <tr key={row.categoryId}>
                          <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">
                            {row.label}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num text-xs text-slate-500 dark:text-slate-400">
                            {row.monthsObserved}m
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num text-xs text-slate-600 dark:text-slate-400">
                            {formatPrecise(row.historicalMean, forcePence)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num font-medium text-slate-900 dark:text-slate-100">
                            {row.riskStatus === 'insufficient_data'
                              ? '—'
                              : formatPrecise(row.projectedNextMonth, forcePence)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono-num text-xs text-slate-600 dark:text-slate-400">
                            {row.monthlyCap !== null
                              ? formatPrecise(row.monthlyCap, forcePence)
                              : '—'}
                          </td>
                          <td className="py-2 pl-3 text-right font-mono-num text-xs">
                            {row.riskStatus === 'projected_over' &&
                            row.projectedVsLimitDelta !== null ? (
                              <span className="font-medium text-red-700 dark:text-red-400">
                                Over +{formatPrecise(row.projectedVsLimitDelta, forcePence)}
                              </span>
                            ) : row.riskStatus === 'variance_risk' ? (
                              <span className="font-medium text-amber-700 dark:text-amber-400">
                                Variance risk
                              </span>
                            ) : row.riskStatus === 'insufficient_data' ? (
                              <span className="text-slate-500 dark:text-slate-400">
                                Insufficient data
                              </span>
                            ) : row.riskStatus === 'on_track' ? (
                              <span className="text-teal-700 dark:text-teal-400">On track</span>
                            ) : (
                              <span className="text-slate-500 dark:text-slate-400">Uncapped</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {reportData.upcomingBills.dueSoon.length > 0 && (
              <div className="pt-2 space-y-2">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Upcoming Bills (Next {reportData.upcomingBills.windowDays} Days)
                  </span>
                  <span className="font-mono-num text-slate-600 dark:text-slate-400">
                    Total {formatMoney(reportData.upcomingBills.totalDueSoon, currency, 2)}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {reportData.upcomingBills.dueSoon.slice(0, 6).map((bill) => (
                    <div
                      key={bill.id}
                      className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {bill.merchant}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400 font-mono-num">
                          Due {bill.dueDate} · {bill.categoryLabel}
                        </p>
                      </div>
                      <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                        {formatMoney(bill.expectedAmount, currency, 2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Category Breakdown Section */}
        {includeCategoryBreakdown && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {reportData.isQuarterly
                  ? 'Category Breakdown & Quarterly Caps'
                  : 'Category Breakdown & Monthly Caps'}
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                {reportData.categories.length} categories
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-4">Category</th>
                    <th className="py-2.5 px-3">Class</th>
                    <th className="py-2.5 px-3 text-right">Tx</th>
                    <th className="py-2.5 px-3 text-right">Spend</th>
                    <th className="py-2.5 px-3 text-right">{reportData.periodCapLabel}</th>
                    <th className="py-2.5 pl-3 text-right">Status / Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {reportData.categories.map((row) => {
                    const forcePence =
                      row.variance !== null &&
                      row.variance > 0 &&
                      Math.round(row.variance) === 0;
                    return (
                      <tr key={row.categoryId}>
                        <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-slate-100">
                          {row.label}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-xs ${
                            row.spendingClass === 'non-essential'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {row.spendingClass === 'essential' ? 'Essential' : 'Non-Essential'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-xs text-slate-500 dark:text-slate-400">
                          {row.transactionCount}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num font-medium text-slate-900 dark:text-slate-100">
                          {formatPrecise(row.amount, forcePence)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-xs text-slate-600 dark:text-slate-400">
                          {row.monthlyCap !== null
                            ? formatPrecise(row.monthlyCap, forcePence)
                            : '—'}
                        </td>
                        <td className="py-2.5 pl-3 text-right font-mono-num text-xs">
                          {row.variance !== null && row.variance > 0 ? (
                            <span className="font-medium text-red-700 dark:text-red-400">
                              Over +{formatPrecise(row.variance, forcePence)}
                            </span>
                          ) : row.variance !== null ? (
                            <span className="text-teal-700 dark:text-teal-400">
                              Within cap · {row.sharePct.toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">
                              {row.sharePct.toFixed(1)}% of spend
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Ledger Summary & Smart-Tagged Activity */}
        {includeLedgerSummary && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Ledger Summary &amp; Smart-Tagged Activity
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                {reportData.ledgerSummary.dateRangeStart && reportData.ledgerSummary.dateRangeEnd
                  ? `${reportData.ledgerSummary.dateRangeStart} to ${reportData.ledgerSummary.dateRangeEnd}`
                  : `${reportData.ledgerSummary.totalRows} entries`}
              </span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Ledger Entries</p>
                <p className="mt-1 text-lg font-semibold font-mono-num text-slate-900 dark:text-slate-100">
                  {reportData.ledgerSummary.totalRows}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                  {reportData.ledgerSummary.inflowCount} in · {reportData.ledgerSummary.outflowCount} out
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Avg Outflow Ticket</p>
                <p className="mt-1 text-lg font-semibold font-mono-num text-slate-900 dark:text-slate-100">
                  {formatMoney(reportData.ledgerSummary.avgOutflowTicket, currency, 2)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                  {reportData.ledgerSummary.savingsTransferCount} savings transfers
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Tax Deductible</p>
                <p className="mt-1 text-lg font-semibold font-mono-num text-teal-700 dark:text-teal-400">
                  {formatMoney(reportData.smartTags.taxDeductibleTotal, currency, 2)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                  {reportData.smartTags.taxDeductibleCount} auto-tagged rows
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Expense Claimable</p>
                <p className="mt-1 text-lg font-semibold font-mono-num text-teal-700 dark:text-teal-400">
                  {formatMoney(reportData.smartTags.expenseClaimableTotal, currency, 2)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                  {reportData.smartTags.expenseClaimableCount} auto-tagged rows
                </p>
              </div>
            </div>

            {reportData.ledgerSummary.monthlyLedgerSeries.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-4">Month</th>
                      <th className="py-2 px-3 text-right">Income</th>
                      <th className="py-2 px-3 text-right">Essential</th>
                      <th className="py-2 px-3 text-right">Non-Essential</th>
                      <th className="py-2 px-3 text-right">Total Spend</th>
                      <th className="py-2 pl-3 text-right">Net Cash Flow</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {reportData.ledgerSummary.monthlyLedgerSeries.map((m) => (
                      <tr key={m.monthKey}>
                        <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">
                          {m.label}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num text-xs text-teal-700 dark:text-teal-400">
                          {formatPrecise(m.income)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num text-xs text-slate-600 dark:text-slate-400">
                          {formatPrecise(m.essential)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num text-xs text-amber-700 dark:text-amber-400">
                          {formatPrecise(m.nonEssential)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num font-medium text-slate-900 dark:text-slate-100">
                          {formatPrecise(m.totalSpending)}
                        </td>
                        <td
                          className={`py-2 pl-3 text-right font-mono-num text-xs font-semibold ${
                            m.netCashFlow >= 0
                              ? 'text-teal-700 dark:text-teal-400'
                              : 'text-red-700 dark:text-red-400'
                          }`}
                        >
                          {formatPrecise(m.netCashFlow)} ({m.savingsRate.toFixed(0)}%)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {reportData.ledgerSummary.topMerchants.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-4">Top Merchants in Period</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3 text-right">Tx</th>
                      <th className="py-2 px-3 text-right">Share</th>
                      <th className="py-2 pl-3 text-right">Total Outflow</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {reportData.ledgerSummary.topMerchants.slice(0, 6).map((m) => (
                      <tr key={`${m.merchant}-${m.categoryLabel}`}>
                        <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">
                          {m.merchant}
                        </td>
                        <td className="py-2 px-3 text-xs text-slate-500 dark:text-slate-400">
                          {m.categoryLabel}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num text-xs text-slate-500 dark:text-slate-400">
                          {m.count}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num text-xs text-slate-500 dark:text-slate-400">
                          {m.sharePct.toFixed(1)}%
                        </td>
                        <td className="py-2 pl-3 text-right font-mono-num font-medium text-slate-900 dark:text-slate-100">
                          {formatMoney(m.total, currency, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {reportData.ledgerTransactions.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Exported PDF includes up to 45 chronological ledger register entries with Smart Tags ({Math.min(45, reportData.ledgerTransactions.length)} of {reportData.ledgerTransactions.length} entries in this period).
              </p>
            )}
          </section>
        )}

        {/* Potential Savings Recommendations */}
        {includeRecommendations && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Potential Savings Recommendations
              </h3>
              <span className="text-xs font-mono-num font-medium text-teal-700 dark:text-teal-400">
                {formatMoney(reportData.potentialMonthlySavings, currency)}/mo ·{' '}
                {formatMoney(reportData.potentialAnnualSavings, currency)}/yr · 5-Yr Cash ISA:{' '}
                {formatMoney(reportData.fiveYearCashIsaProjection, currency)}
              </span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {reportData.recommendations.map((rec) => {
                const monthlySaving = rec.currentMonthly * (rec.activeCutPct / 100);
                return (
                  <div
                    key={rec.id}
                    className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start justify-between gap-2"
                  >
                    <div className="space-y-1 max-w-2xl">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {rec.title}{' '}
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                          · {rec.enabled ? 'Active in plan' : 'Optional'} · {rec.effort}
                        </span>
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {rec.rationale}
                      </p>
                    </div>
                    <div className="sm:text-right shrink-0 font-mono-num">
                      <p
                        className={`text-sm font-semibold ${
                          rec.enabled
                            ? 'text-teal-700 dark:text-teal-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        +{formatMoney(monthlySaving, currency)}/mo
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        -{rec.activeCutPct}% cut target
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Recurring Subscriptions Flagged */}
        {includeSubscriptions && reportData.cancelableSubscriptions.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Recurring Subscriptions Marked for Savings
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                {reportData.cancelableSubscriptions.length} recurring items
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-4">Merchant</th>
                    <th className="py-2 px-3">Category</th>
                    <th className="py-2 px-3">Action</th>
                    <th className="py-2 px-3 text-right">Monthly Cost</th>
                    <th className="py-2 pl-3 text-right">Annual Saving</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {reportData.cancelableSubscriptions.map((sub) => (
                    <tr key={sub.id}>
                      <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">
                        {sub.merchant}
                      </td>
                      <td className="py-2 px-3 text-xs text-slate-500 dark:text-slate-400">
                        {sub.categoryLabel}
                      </td>
                      <td className="py-2 px-3 text-xs text-amber-700 dark:text-amber-400 font-medium">
                        {sub.action === 'cancel'
                          ? 'Cancel'
                          : sub.action === 'downgrade'
                            ? 'Negotiate (-35%)'
                            : 'Review'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-num text-xs text-slate-700 dark:text-slate-300">
                        {formatMoney(sub.monthlyCost, currency, 2)}
                      </td>
                      <td className="py-2 pl-3 text-right font-mono-num font-medium text-teal-700 dark:text-teal-400">
                        {formatMoney(sub.potentialMonthlySaving * 12, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Savings vs. Debt Payoff Comparison Table */}
        {includeSavingsVsDebt && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Savings vs. Debt Payoff Comparison
              </h3>
              {reportData.savingsVsDebt ? (
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                  {formatMoney(reportData.savingsVsDebt.totalStartingDebt, currency)} starting debt ·{' '}
                  {reportData.savingsVsDebt.weightedAvgApr.toFixed(1)}% avg APR ·{' '}
                  {formatMoney(reportData.savingsVsDebt.extraMonthlyBudget, currency)}/mo extra budget
                </span>
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  No active debt accounts
                </span>
              )}
            </div>

            {!reportData.savingsVsDebt ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                No active debt balances configured. Add loans or credit cards in the Debt tab to compare Avalanche, Snowball, and Cash ISA strategies in your PDF report.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 pr-4">Strategy</th>
                        <th className="py-2.5 px-3">Debt-Free Date</th>
                        <th className="py-2.5 px-3 text-right">Total Interest</th>
                        <th className="py-2.5 px-3 text-right">Ending Debt</th>
                        <th className="py-2.5 px-3 text-right">Cash ISA Balance</th>
                        <th className="py-2.5 pl-3 text-right">Final Net Position</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {[
                        {
                          key: 'avalanche',
                          label: 'Debt Avalanche (Highest APR First)',
                          outcome: reportData.savingsVsDebt.avalanche,
                          highlight: true,
                        },
                        {
                          key: 'snowball',
                          label: 'Debt Snowball (Smallest Balance First)',
                          outcome: reportData.savingsVsDebt.snowball,
                          highlight: false,
                        },
                        {
                          key: 'savings',
                          label: `Current Savings Path (Cash ISA ${reportData.isaCashRatePct.toFixed(1)}% AER)`,
                          outcome: reportData.savingsVsDebt.savingsPath,
                          highlight: false,
                        },
                      ].map((row) => (
                        <tr key={row.key}>
                          <td
                            className={`py-2.5 pr-4 font-medium ${
                              row.highlight
                                ? 'text-teal-700 dark:text-teal-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {row.label}
                          </td>
                          <td className="py-2.5 px-3 text-xs font-mono-num text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {row.outcome.debtFreeDateLabel}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-num text-xs text-amber-700 dark:text-amber-400">
                            {formatMoney(row.outcome.totalInterestPaid, currency)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-num text-xs text-slate-600 dark:text-slate-400">
                            {formatMoney(row.outcome.finalDebtRemaining, currency)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-num text-xs text-teal-700 dark:text-teal-400">
                            {formatMoney(row.outcome.finalIsaSavings, currency)}
                          </td>
                          <td
                            className={`py-2.5 pl-3 text-right font-mono-num font-semibold ${
                              row.outcome.finalNetPosition >= 0
                                ? 'text-teal-700 dark:text-teal-400'
                                : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {formatMoney(row.outcome.finalNetPosition, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="p-3.5 rounded-lg bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200/70 dark:border-teal-800/70 text-xs text-teal-900 dark:text-teal-200 leading-relaxed">
                  {reportData.savingsVsDebt.netAdvantageAvalancheVsSavingsPath >= 0 ? (
                    <>
                      <strong className="font-semibold">Key Takeaway:</strong> Debt Avalanche clears balances{' '}
                      <span className="font-mono-num font-semibold">
                        {reportData.savingsVsDebt.monthsSavedAvalancheVsMinimum} months faster
                      </span>{' '}
                      than minimums, saves{' '}
                      <span className="font-mono-num font-semibold">
                        {formatMoney(reportData.savingsVsDebt.interestSavedAvalancheVsMinimum, currency)}
                      </span>{' '}
                      in interest, and improves your ending net position by{' '}
                      <span className="font-mono-num font-semibold">
                        +{formatMoney(reportData.savingsVsDebt.netAdvantageAvalancheVsSavingsPath, currency)}
                      </span>{' '}
                      over saving in a Cash ISA at {reportData.isaCashRatePct.toFixed(1)}% AER.
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold">Key Takeaway:</strong> Because your Cash ISA yield (
                      {reportData.isaCashRatePct.toFixed(1)}% AER) outperforms your weighted debt APR (
                      {reportData.savingsVsDebt.weightedAvgApr.toFixed(1)}%), prioritizing the Savings Path yields{' '}
                      <span className="font-mono-num font-semibold">
                        +
                        {formatMoney(
                          Math.abs(reportData.savingsVsDebt.netAdvantageAvalancheVsSavingsPath),
                          currency
                        )}
                      </span>{' '}
                      higher net wealth over {reportData.savingsVsDebt.horizonMonths} months.
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* Top Outgoing Transactions */}
        {includeTopTransactions && reportData.topTransactions.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Largest Outgoing Transactions
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                Top {reportData.topTransactions.length} expenses
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-4 w-28">Date</th>
                    <th className="py-2 px-3">Merchant</th>
                    <th className="py-2 px-3">Category</th>
                    <th className="py-2 pl-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {reportData.topTransactions.map((tx) => {
                    const txCurr = tx.currency ?? currency;
                    const displayAmt = Math.abs(
                      getTransactionDisplayAmount(tx, currency, exchangeRates)
                    );
                    const isForeign = txCurr !== currency;
                    return (
                      <tr key={tx.id}>
                        <td className="py-2 pr-4 font-mono-num text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {tx.date}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                          {tx.merchant}
                        </td>
                        <td className="py-2 px-3 text-xs text-slate-500 dark:text-slate-400">
                          {CATEGORIES[tx.category].label}
                        </td>
                        <td className="py-2 pl-3 text-right font-mono-num font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          <span>{formatMoney(displayAmt, currency, 2)}</span>
                          {isForeign && (
                            <span className="ml-1.5 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                              ({formatMoney(Math.abs(tx.amount), txCurr, 2)})
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </article>
    </div>
  );
};
