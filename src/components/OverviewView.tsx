import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  FileDown,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  formatMoney,
  type CategoryId,
  type CurrencyCode,
  type ExchangeRateTable,
  type MonthlyBreakdown,
  type Transaction,
} from '../types/finance';
import {
  computeCategoryVarianceProjections,
  type AnalyticsResult,
} from '../utils/analyticsEngine';
import { D3SpendingTrendChart } from './D3SpendingTrendChart';
import { SpendingCalendarHeatmap } from './SpendingCalendarHeatmap';
import { UpcomingBillsWidget } from './UpcomingBillsWidget';

interface OverviewViewProps {
  analytics: AnalyticsResult;
  twelveMonthSeries: MonthlyBreakdown[];
  transactions: Transaction[];
  currency: CurrencyCode;
  exchangeRates?: Partial<ExchangeRateTable>;
  timeframe: 'all' | 12 | 6;
  onTimeframeChange: (tf: 'all' | 12 | 6) => void;
  onUpdateCategoryCap: (categoryId: CategoryId, cap: number | null) => void;
  onNavigate: (
    tab:
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
      | 'faq'
  ) => void;
  onOpenImport: () => void;
  onExportCurrentMonthPdf?: () => string | null;
  isSampleData: boolean;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  analytics,
  twelveMonthSeries,
  transactions,
  currency,
  exchangeRates,
  timeframe,
  onTimeframeChange,
  onUpdateCategoryCap,
  onNavigate,
  onOpenImport,
  onExportCurrentMonthPdf,
  isSampleData,
}) => {
  const [editingCaps, setEditingCaps] = useState(false);
  const [showTrendProjection, setShowTrendProjection] = useState(false);
  const [proRatePartialMonth, setProRatePartialMonth] = useState(false);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);

  const categoryCapsMap = useMemo(() => {
    const map: Partial<Record<CategoryId, number>> = {};
    for (const item of analytics.categoryCapStatuses) {
      if (item.monthlyCap !== null && item.monthlyCap > 0) {
        map[item.categoryId] = item.monthlyCap;
      }
    }
    return map;
  }, [analytics.categoryCapStatuses]);

  const trendProjection = useMemo(
    () =>
      computeCategoryVarianceProjections(
        transactions,
        categoryCapsMap,
        currency,
        exchangeRates,
        { proRatePartialMonth }
      ),
    [transactions, categoryCapsMap, currency, exchangeRates, proRatePartialMonth]
  );

  const projectionByCategory = useMemo(() => {
    const map = new Map<CategoryId, (typeof trendProjection.categories)[number]>();
    for (const item of trendProjection.categories) {
      map.set(item.categoryId, item);
    }
    return map;
  }, [trendProjection.categories]);

  if (analytics.monthCount === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 md:p-12 text-center max-w-2xl mx-auto my-8">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          Upload 12 months of bank statements to begin
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
          Every statement is parsed and analyzed locally inside your device. Nothing leaves your computer or phone.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onOpenImport}
            className="min-h-[44px] px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Import Bank Statements
          </button>
        </div>
      </div>
    );
  }

  const topCategories = analytics.categoryDrains.slice(0, 7);
  const maxCategoryMonthly = Math.max(...topCategories.map((c) => c.monthlyAverage), 1);
  const topMerchants = analytics.merchantDrains
    .filter((m) => m.categoryId !== 'housing')
    .slice(0, 6);

  const essentialPctOfIncome =
    analytics.avgMonthlyIncome > 0
      ? (analytics.avgMonthlyEssential / analytics.avgMonthlyIncome) * 100
      : 0;
  const nonEssentialPctOfIncome =
    analytics.avgMonthlyIncome > 0
      ? (analytics.avgMonthlyNonEssential / analytics.avgMonthlyIncome) * 100
      : 0;
  const savingsPctOfIncome = Math.max(0, 100 - essentialPctOfIncome - nonEssentialPctOfIncome);

  const projectedMonthlyPotential =
    analytics.avgMonthlySurplus + analytics.totalRecommendedMonthlySavings;

  const cappedItems = analytics.categoryCapStatuses.filter((c) => c.monthlyCap !== null);
  const formatProjectionMoney = (val: number, forcePence = false) => {
    const hasFractionalPence = Math.abs(val - Math.round(val)) >= 0.005;
    const needsPence =
      forcePence || (hasFractionalPence && (Math.abs(val) < 10 || Math.round(val) === 0));
    return formatMoney(val, currency, needsPence ? 2 : 0);
  };
  const capChartData = cappedItems.slice(0, 7).map((c) => {
    const proj = projectionByCategory.get(c.categoryId);
    return {
      name: c.label.split('&')[0].trim().slice(0, 14),
      fullName: c.label,
      actual: Math.round(c.monthlyAverage),
      projected: proj ? proj.projectedNextMonth : Math.round(c.monthlyAverage),
      upperBound: proj ? proj.upperBoundSpend : Math.round(c.monthlyAverage),
      stdDev: proj ? proj.stdDev : 0,
      cap: Math.round(c.monthlyCap ?? 0),
    };
  });
  const overCapCount = cappedItems.filter((c) => c.status === 'over').length;
  const flaggedProjectionCategories = trendProjection.categories.filter(
    (c) => c.riskStatus === 'projected_over' || c.riskStatus === 'variance_risk'
  );

  return (
    <div className="space-y-6">
      {/* Contextual Top Summary Strip & Timeframe Selector */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Financial Overview
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>{analytics.monthCount} months analyzed</span>
            <span aria-hidden="true">·</span>
            <span>{analytics.dateRangeLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{isSampleData ? 'Sample 14-month ledger' : 'Your local statements'}</span>
            {analytics.currencyBreakdown.length > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => onNavigate('vault')}
                  className="text-teal-700 dark:text-teal-400 hover:underline font-medium cursor-pointer"
                >
                  {analytics.currencyBreakdown.map((c) => c.currency).join(' / ')} normalized to{' '}
                  {currency}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {onExportCurrentMonthPdf && (
            <button
              type="button"
              onClick={() => {
                const exportedName = onExportCurrentMonthPdf();
                if (exportedName) {
                  setPdfNotice(`Exported current month summary & projections to ${exportedName}.`);
                  window.setTimeout(() => setPdfNotice(null), 5000);
                }
              }}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
              Export Month PDF
            </button>
          )}
          <div
            className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg"
            role="group"
            aria-label="Analysis timeframe"
          >
            {(
              [
                { id: 'all', label: 'All Months' },
                { id: 12, label: '12 Months' },
                { id: 6, label: '6 Months' },
              ] as const
            ).map((opt) => (
              <button
                key={String(opt.id)}
                type="button"
                onClick={() => onTimeframeChange(opt.id)}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  timeframe === opt.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pdfNotice && (
        <div
          role="status"
          className="p-3 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs font-medium text-teal-900 dark:text-teal-200"
        >
          {pdfNotice}
        </div>
      )}

      {/* Primary KPI Grid — 4 structured metrics separated cleanly by hairlines */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Avg. Monthly Net Income
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(analytics.avgMonthlyIncome, currency)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {formatMoney(analytics.totalIncome, currency)} total over {analytics.monthCount} mo
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Essential vs. Non-Essential
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {Math.round(analytics.essentialSharePct)}% / {Math.round(analytics.nonEssentialSharePct)}%
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            {formatMoney(analytics.avgMonthlyEssential, currency)} essential ·{' '}
            {formatMoney(analytics.avgMonthlyNonEssential, currency)} discretionary
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Cancelable Subscriptions
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(analytics.cancelableRecurringMonthly, currency)}
            <span className="text-sm font-normal text-slate-500">/mo</span>
          </p>
          <button
            type="button"
            onClick={() => onNavigate('subscriptions')}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400 cursor-pointer"
          >
            Audit {analytics.recurringItems.length} detected recurring bills
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-5 bg-teal-50/50 dark:bg-teal-950/20 rounded-b-xl xl:rounded-b-none xl:rounded-r-xl">
          <p className="text-xs font-medium text-teal-800 dark:text-teal-300">
            Potential Monthly Savings
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-teal-700 dark:text-teal-400">
            {formatMoney(projectedMonthlyPotential, currency)}
            <span className="text-sm font-normal text-teal-700/80 dark:text-teal-400/80">/mo</span>
          </p>
          <button
            type="button"
            onClick={() => onNavigate('cuts')}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
          >
            +{formatMoney(analytics.totalRecommendedMonthlySavings, currency)}/mo from cuts &amp; subs
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Upcoming Bills Due Within Next 7 Days */}
      <UpcomingBillsWidget
        summary={analytics.upcomingBills}
        currency={currency}
        onManageSubscriptions={() => onNavigate('subscriptions')}
        onInspectLedger={() => onNavigate('ledger')}
      />

      {/* Main Chart + 50/30/20 Essential Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* 12+ Month Cash Flow Stacked Bar Chart */}
        <section className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Monthly Essential vs. Non-Essential Spending
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Track spending spikes and seasonal patterns across your uploaded statements
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400 shrink-0">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-slate-700 dark:bg-slate-400 inline-block" />
                Essential
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                Non-Essential
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-teal-600 inline-block" />
                Surplus
              </span>
            </div>
          </div>

          <div className="w-full h-[270px] sm:h-[300px] mt-auto">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.monthlySeries.map((m) => ({
                  ...m,
                  essential: Math.round(m.essential),
                  nonEssential: Math.round(m.nonEssential),
                  surplus: Math.max(0, Math.round(m.netCashFlow)),
                }))}
                margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cbd5e1" opacity={0.35} />
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
                    const labelMap: Record<string, string> = {
                      essential: 'Essential Spending',
                      nonEssential: 'Non-Essential Spending',
                      surplus: 'Monthly Surplus',
                    };
                    const key = String(name);
                    return [formatMoney(Number(value), currency), labelMap[key] ?? key];
                  }}
                />
                <Bar dataKey="essential" stackId="a" fill="#334155" radius={[0, 0, 0, 0]} maxBarSize={32} />
                <Bar dataKey="nonEssential" stackId="a" fill="#d97706" radius={[0, 0, 0, 0]} maxBarSize={32} />
                <Bar dataKey="surplus" stackId="a" fill="#0f766e" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Essential vs Non-Essential Income Allocation Benchmark */}
        <section className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Income Allocation vs. 50 / 30 / 20
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              How every {formatMoney(100, currency)} of net income is currently spent
            </p>

            {/* Stacked proportion strip */}
            <div className="mt-5 h-3 w-full rounded-md overflow-hidden flex bg-slate-100 dark:bg-slate-800">
              <div
                style={{ width: `${Math.min(100, essentialPctOfIncome)}%` }}
                className="bg-slate-700 dark:bg-slate-400"
                title="Essential"
              />
              <div
                style={{ width: `${Math.min(100, nonEssentialPctOfIncome)}%` }}
                className="bg-amber-500"
                title="Non-Essential"
              />
              <div
                style={{ width: `${Math.min(100, savingsPctOfIncome)}%` }}
                className="bg-teal-600"
                title="Savings & Surplus"
              />
            </div>

            <div className="mt-5 divide-y divide-slate-100 dark:divide-slate-800">
              <div className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Essential Needs
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Target ~50% · Housing, bills, groceries
                  </p>
                </div>
                <div className="text-right font-mono-num">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {essentialPctOfIncome.toFixed(1)}%
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatMoney(analytics.avgMonthlyEssential, currency)}/mo
                  </p>
                </div>
              </div>

              <div className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Non-Essential Wants
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Target ≤30% · Dining, retail, subscriptions
                  </p>
                </div>
                <div className="text-right font-mono-num">
                  <p
                    className={`text-sm font-semibold ${
                      nonEssentialPctOfIncome > 30
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {nonEssentialPctOfIncome.toFixed(1)}%
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatMoney(analytics.avgMonthlyNonEssential, currency)}/mo
                  </p>
                </div>
              </div>

              <div className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Saved / Unspent Surplus
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Target ≥20% · Cash ISA, LISA, buffer
                  </p>
                </div>
                <div className="text-right font-mono-num">
                  <p className="text-sm font-semibold text-teal-700 dark:text-teal-400">
                    {savingsPctOfIncome.toFixed(1)}%
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatMoney(analytics.avgMonthlySurplus, currency)}/mo
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-600 dark:text-slate-400">
              With active cuts, savings rate climbs to{' '}
              <strong className="font-mono-num text-teal-700 dark:text-teal-400">
                {analytics.avgMonthlyIncome > 0
                  ? ((projectedMonthlyPotential / analytics.avgMonthlyIncome) * 100).toFixed(1)
                  : '0.0'}
                %
              </strong>
            </span>
            <button
              type="button"
              onClick={() => onNavigate('wealth')}
              className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              Project ISA →
            </button>
          </div>
        </section>
      </div>

      {/* 12-Month D3 Line Chart — Progress Cutting Non-Essential Expenses */}
      <D3SpendingTrendChart
        monthlySeries={twelveMonthSeries}
        currency={currency}
        nonEssentialTarget={Math.max(
          0,
          Math.round(analytics.avgMonthlyNonEssential - analytics.totalRecommendedMonthlySavings)
        )}
      />

      {/* Calendar-Based Daily Spending Intensity & Volume Heatmap */}
      <SpendingCalendarHeatmap
        transactions={transactions}
        currency={currency}
        exchangeRates={exchangeRates}
      />

      {/* Custom Monthly Category Spending Caps — Actual vs. Limit & Variance Trend Projection */}
      <section
        id="spending-caps-section"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5 scroll-mt-20"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {showTrendProjection
                ? `Spending Trend Projection (${trendProjection.nextMonthLabel}) vs. Limits`
                : 'Custom Monthly Spending Caps vs. Actuals'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {showTrendProjection ? (
                <>
                  Variance forecast across {trendProjection.monthsAnalyzed}{' '}
                  {trendProjection.partialMonthMode === 'prorated'
                    ? 'months (latest pro-rated)'
                    : 'completed months'}
                  {trendProjection.partialMonthMode === 'excluded' &&
                  trendProjection.partialMonthLabel
                    ? ` (partial ${trendProjection.partialMonthLabel} excluded)`
                    : ''}{' '}
                  · Est. total{' '}
                  <span className="font-mono-num font-medium text-slate-800 dark:text-slate-200">
                    {formatMoney(trendProjection.totalProjectedNextMonth, currency)}
                  </span>{' '}
                  (1σ upper {formatMoney(trendProjection.totalUpperBound, currency)}) ·{' '}
                  {trendProjection.projectedOverLimitCount > 0 ? (
                    <span className="text-red-600 dark:text-red-400 font-medium font-mono-num">
                      {trendProjection.projectedOverLimitCount} projected over limit
                    </span>
                  ) : trendProjection.varianceRiskCount > 0 ? (
                    <span className="text-amber-700 dark:text-amber-400 font-medium font-mono-num">
                      {trendProjection.varianceRiskCount} variance risk
                    </span>
                  ) : (
                    <span className="text-teal-700 dark:text-teal-400 font-medium">
                      All capped categories projected within limit
                    </span>
                  )}
                </>
              ) : (
                <>
                  {cappedItems.length} categories capped ·{' '}
                  {overCapCount > 0 ? (
                    <span className="text-red-600 dark:text-red-400 font-medium font-mono-num">
                      {overCapCount} over cap (+{formatMoney(analytics.totalOverCapMonthly, currency)}/mo overspend)
                    </span>
                  ) : (
                    <span className="text-teal-700 dark:text-teal-400 font-medium">
                      All capped categories within limit
                    </span>
                  )}
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            <button
              type="button"
              onClick={() => setShowTrendProjection((v) => !v)}
              aria-pressed={showTrendProjection}
              className={`min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showTrendProjection
                  ? 'border-teal-700 bg-teal-700 text-white hover:bg-teal-800'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              {showTrendProjection ? 'Trend Projection: On' : 'Spending Trend Projection'}
            </button>

            <button
              type="button"
              onClick={() => setEditingCaps((v) => !v)}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {editingCaps ? 'Done Editing Caps' : 'Edit Monthly Caps'}
            </button>
          </div>
        </div>

        {/* Partial Data Indicator + Opt-In Pro-Rating Control */}
        {showTrendProjection && trendProjection.partialMonthKey && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
            <div className="text-slate-600 dark:text-slate-300 leading-relaxed">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Partial data ({trendProjection.partialMonthLabel} ·{' '}
                {trendProjection.partialMonthDaysElapsed}/{trendProjection.partialMonthDaysInMonth}d):
              </span>{' '}
              {trendProjection.partialMonthMode === 'prorated'
                ? 'Pro-rated to full-month pace and included in baseline.'
                : 'Excluded from baseline so partial totals do not bias forecasts low.'}
            </div>
            <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-200 font-medium cursor-pointer select-none whitespace-nowrap shrink-0">
              <input
                type="checkbox"
                checked={proRatePartialMonth}
                onChange={(e) => setProRatePartialMonth(e.target.checked)}
                className="w-4 h-4 rounded accent-teal-700"
              />
              <span>Pro-rate partial month</span>
            </label>
          </div>
        )}

        {/* Projected vs. Limit Warning Banner (shown when Trend Projection is toggled on) */}
        {showTrendProjection && (
          <div
            className={`rounded-lg border p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
              trendProjection.projectedOverLimitCount > 0
                ? 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-900/60'
                : trendProjection.varianceRiskCount > 0
                  ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/60'
                  : 'bg-teal-50/70 dark:bg-teal-950/30 border-teal-200 dark:border-teal-900/60'
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <AlertTriangle
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  trendProjection.projectedOverLimitCount > 0
                    ? 'text-red-600 dark:text-red-400'
                    : trendProjection.varianceRiskCount > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-teal-700 dark:text-teal-400'
                }`}
              />
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {trendProjection.projectedOverLimitCount > 0
                    ? `Projected vs. Limit Warning: ${trendProjection.projectedOverLimitCount} ${
                        trendProjection.projectedOverLimitCount === 1 ? 'category is' : 'categories are'
                      } forecast to exceed limits in ${trendProjection.nextMonthLabel}`
                    : trendProjection.varianceRiskCount > 0
                      ? `Variance Watch: ${trendProjection.varianceRiskCount} ${
                          trendProjection.varianceRiskCount === 1 ? 'category could' : 'categories could'
                        } breach limits if spending hits its +1σ band in ${trendProjection.nextMonthLabel}`
                      : `On Track for ${trendProjection.nextMonthLabel}: All capped categories are projected within limits`}
                </p>
                {flaggedProjectionCategories.length > 0 ? (
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    Flagged:{' '}
                    {flaggedProjectionCategories
                      .slice(0, 4)
                      .map((c) =>
                        c.riskStatus === 'projected_over'
                          ? `${c.label} (${formatMoney(c.projectedNextMonth, currency)} proj. vs ${formatMoney(c.monthlyCap ?? 0, currency)} cap)`
                          : `${c.label} (up to ${formatMoney(c.upperBoundSpend, currency)} vs ${formatMoney(c.monthlyCap ?? 0, currency)} cap)`
                      )
                      .join(' · ')}
                  </p>
                ) : (
                  <p className="text-slate-600 dark:text-slate-400">
                    Forecast blends historical monthly mean, sample variance (±1σ), and recent 3-month spending momentum.
                  </p>
                )}
              </div>
            </div>
            <div className="text-left sm:text-right font-mono-num shrink-0 text-xs">
              <p className="text-slate-500 dark:text-slate-400">vs. Historical Avg</p>
              <p
                className={`font-semibold ${
                  trendProjection.projectedDeltaPct > 2
                    ? 'text-red-600 dark:text-red-400'
                    : trendProjection.projectedDeltaPct < -2
                      ? 'text-teal-700 dark:text-teal-400'
                      : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {trendProjection.projectedDeltaPct >= 0 ? '+' : ''}
                {trendProjection.projectedDeltaPct.toFixed(1)}%
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Grouped Actual or Projected vs. Cap Bar Chart */}
          <div className="lg:col-span-5 flex flex-col">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-3">
              <span>
                {showTrendProjection
                  ? `Projected (${trendProjection.nextMonthLabel}) vs. Limit`
                  : 'Monthly Average vs. Custom Limit'}
              </span>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-xs inline-block ${
                      showTrendProjection ? 'bg-teal-600' : 'bg-amber-500'
                    }`}
                  />
                  {showTrendProjection ? 'Projected' : 'Actual'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 dark:bg-slate-600 inline-block" />
                  Cap
                </span>
              </div>
            </div>
            {capChartData.length === 0 ? (
              <p className="text-xs text-slate-500 py-10 text-center">
                Click &ldquo;Edit Monthly Caps&rdquo; to set limits for any spending category.
              </p>
            ) : (
              <div className="w-full h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={capChartData}
                    margin={{ top: 4, right: 6, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cbd5e1" opacity={0.35} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: '#64748b' }}
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
                      formatter={(val: unknown, name: unknown, item: { payload?: (typeof capChartData)[number] }) => {
                        const key = String(name);
                        if (key === 'projected') {
                          const sd = item.payload?.stdDev ?? 0;
                          return [
                            `${formatMoney(Number(val), currency)} (±${formatMoney(sd, currency)})`,
                            `Projected ${trendProjection.nextMonthLabel}`,
                          ];
                        }
                        return [
                          formatMoney(Number(val), currency),
                          key === 'actual' ? 'Actual Avg/mo' : 'Monthly Cap',
                        ];
                      }}
                    />
                    <Bar
                      dataKey={showTrendProjection ? 'projected' : 'actual'}
                      fill={showTrendProjection ? '#0f766e' : '#d97706'}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={18}
                    />
                    <Bar dataKey="cap" fill="#94a3b8" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Cap Progress Rows & Inline Cap Inputs */}
          <div className="lg:col-span-7 divide-y divide-slate-100 dark:divide-slate-800">
            {(editingCaps ? analytics.categoryCapStatuses : cappedItems).map((item) => {
              const proj = projectionByCategory.get(item.categoryId);
              const projectedVal = proj ? proj.projectedNextMonth : Math.round(item.monthlyAverage);
              const effectiveUtilPct =
                item.monthlyCap && item.monthlyCap > 0
                  ? showTrendProjection
                    ? (projectedVal / item.monthlyCap) * 100
                    : item.utilizationPct
                  : 0;
              const barPct = item.monthlyCap ? Math.min(100, effectiveUtilPct) : 0;

              const barColor = showTrendProjection
                ? proj?.riskStatus === 'projected_over'
                  ? 'bg-red-600'
                  : proj?.riskStatus === 'variance_risk'
                    ? 'bg-amber-500'
                    : proj?.riskStatus === 'insufficient_data'
                      ? 'bg-slate-400'
                      : 'bg-teal-600'
                : item.status === 'over'
                  ? 'bg-red-600'
                  : item.status === 'near'
                    ? 'bg-amber-500'
                    : 'bg-teal-600';

              const showPenceForProj = Boolean(
                proj &&
                  proj.monthlyCap !== null &&
                  ((proj.projectedVsLimitDelta !== null &&
                    proj.projectedVsLimitDelta > 0 &&
                    Math.round(proj.projectedVsLimitDelta) === 0) ||
                    (proj.upperVsLimitDelta !== null &&
                      proj.upperVsLimitDelta > 0 &&
                      Math.round(proj.upperVsLimitDelta) === 0))
              );

              return (
                <div key={item.categoryId} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {item.label}
                      </span>
                      {showTrendProjection && proj ? (
                        proj.riskStatus === 'insufficient_data' ? (
                          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                            No completed months yet
                          </span>
                        ) : (
                          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                            Proj {formatProjectionMoney(proj.projectedNextMonth, showPenceForProj)} · ±1σ{' '}
                            {formatProjectionMoney(proj.lowerBoundSpend)}–
                            {formatProjectionMoney(proj.upperBoundSpend)}
                            {proj.partialMonthActual !== null &&
                              trendProjection.partialMonthLabel && (
                                <>
                                  {' '}
                                  · {trendProjection.partialMonthLabel}{' '}
                                  {trendProjection.partialMonthMode === 'prorated' &&
                                  proj.partialMonthProRated !== null
                                    ? `pro-rated: ${formatProjectionMoney(proj.partialMonthProRated)}`
                                    : `so far: ${formatProjectionMoney(proj.partialMonthActual)}`}
                                </>
                              )}
                          </span>
                        )
                      ) : (
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                          Avg {formatMoney(item.monthlyAverage, currency)}/mo
                        </span>
                      )}
                    </div>

                    {editingCaps ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <label
                          htmlFor={`cap-${item.categoryId}`}
                          className="text-xs text-slate-500 dark:text-slate-400"
                        >
                          Cap:
                        </label>
                        <input
                          id={`cap-${item.categoryId}`}
                          type="number"
                          min={0}
                          step={10}
                          placeholder="No cap"
                          value={item.monthlyCap ?? ''}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            if (!val) {
                              onUpdateCategoryCap(item.categoryId, null);
                            } else {
                              const num = parseFloat(val);
                              onUpdateCategoryCap(
                                item.categoryId,
                                Number.isFinite(num) && num > 0 ? num : null
                              );
                            }
                          }}
                          className="w-24 min-h-[34px] px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono-num text-right text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    ) : showTrendProjection && proj ? (
                      <div className="text-right font-mono-num text-xs shrink-0">
                        {proj.riskStatus === 'insufficient_data' ? (
                          <span className="font-medium text-slate-500 dark:text-slate-400">
                            Insufficient data
                          </span>
                        ) : proj.riskStatus === 'projected_over' && proj.projectedVsLimitDelta !== null ? (
                          <span className="font-medium text-red-600 dark:text-red-400">
                            Projected +{formatProjectionMoney(proj.projectedVsLimitDelta, showPenceForProj)} over limit
                          </span>
                        ) : proj.riskStatus === 'variance_risk' ? (
                          <span className="font-medium text-amber-700 dark:text-amber-400">
                            Variance risk · up to {formatProjectionMoney(proj.upperBoundSpend, showPenceForProj)}
                          </span>
                        ) : proj.monthlyCap !== null ? (
                          <span className="font-medium text-teal-700 dark:text-teal-400">
                            On track · {formatProjectionMoney(Math.max(0, proj.monthlyCap - proj.projectedNextMonth))} buffer
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">
                            σ {formatProjectionMoney(proj.stdDev)}/mo
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-right font-mono-num text-xs shrink-0">
                        {item.status === 'over' ? (
                          <span className="font-medium text-red-600 dark:text-red-400">
                            {formatMoney(item.variance, currency)} over the{' '}
                            {formatMoney(item.monthlyCap ?? 0, currency)} cap (
                            {Math.max(1, Math.round(item.utilizationPct - 100))}% over)
                          </span>
                        ) : item.status === 'near' ? (
                          <span className="font-medium text-amber-700 dark:text-amber-400">
                            Near cap · {Math.round(item.utilizationPct)}% of {formatMoney(item.monthlyCap ?? 0, currency)}
                          </span>
                        ) : (
                          <span className="font-medium text-teal-700 dark:text-teal-400">
                            Under by {formatMoney(Math.abs(item.variance), currency)}/mo
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {item.monthlyCap !== null && (
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${Math.max(3, barPct)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono-num text-slate-500 dark:text-slate-400 w-20 text-right shrink-0">
                        Cap {formatMoney(item.monthlyCap, currency)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Where Most Money Is Going: Categories + Top Merchant Drains */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Category Ranking */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Where Most of Your Money Goes
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Ranked by monthly average across {analytics.monthCount} months
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('ledger')}
              className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Inspect Ledger →
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {topCategories.map((cat) => {
              const barWidth = Math.max(4, (cat.monthlyAverage / maxCategoryMonthly) * 100);
              const isNonEss = cat.spendingClass === 'non-essential';
              return (
                <div key={cat.categoryId} className="py-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {cat.label}
                      </span>
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                        {isNonEss ? 'Non-essential' : 'Essential'} · {cat.shareOfSpendingPct.toFixed(1)}% of spend
                      </span>
                    </div>
                    <div className="text-right shrink-0 font-mono-num">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formatMoney(cat.monthlyAverage, currency)}
                        <span className="text-xs font-normal text-slate-500">/mo</span>
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          isNonEss ? 'bg-amber-500' : 'bg-slate-600 dark:bg-slate-400'
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <div className="w-24 text-right text-xs font-mono-num shrink-0">
                      {Math.abs(cat.trendPct) >= 4 ? (
                        <span
                          className={`inline-flex items-center gap-0.5 ${
                            cat.trendPct > 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {cat.trendPct > 0 ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : (
                            <TrendingDown className="w-3 h-3" />
                          )}
                          {cat.trendPct > 0 ? '+' : ''}
                          {Math.round(cat.trendPct)}% 3m
                        </span>
                      ) : (
                        <span className="text-slate-400">Steady</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Key Money Drains (Merchants excluding rent/mortgage) */}
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Top Individual Money Drains
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Highest non-housing merchants pulling cash each month
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('cuts')}
                className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Trim Drains →
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {topMerchants.map((m) => (
                <div
                  key={m.merchant}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {m.merchant}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {m.categoryLabel} · {m.transactionCount} charges
                      {m.priceHikeDetected
                        ? ` · Price up +${m.priceHikeDetected.pctIncrease}%`
                        : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0 font-mono-num">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {formatMoney(m.monthlyAverage, currency)}/mo
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatMoney(m.totalAmount, currency)} total
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {analytics.recurringItems.length} recurring charges detected locally
            </span>
            <button
              type="button"
              onClick={() => onNavigate('subscriptions')}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
            >
              Manage Subscriptions
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
