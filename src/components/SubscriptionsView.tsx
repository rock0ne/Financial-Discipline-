import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarRange,
  Repeat,
  Search,
  TrendingUp,
} from 'lucide-react';
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
  formatMoney,
  type CurrencyCode,
  type SubscriptionClass,
} from '../types/finance';
import {
  computeSubscriptionAnnualProjection,
  type AnalyticsResult,
  type SubscriptionProjectionMonth,
} from '../utils/analyticsEngine';

interface SubscriptionsViewProps {
  analytics: AnalyticsResult;
  currency: CurrencyCode;
  onSetSubscriptionClass: (recId: string, nextClass: SubscriptionClass) => void;
  onNavigateWealth: () => void;
}

export const SubscriptionsView: React.FC<SubscriptionsViewProps> = ({
  analytics,
  currency,
  onSetSubscriptionClass,
  onNavigateWealth,
}) => {
  const [filter, setFilter] = useState<'all' | 'cancelable' | 'essential' | 'hiked'>('all');
  const [search, setSearch] = useState('');
  const [projectionScenario, setProjectionScenario] = useState<'baseline' | 'optimized'>('baseline');

  const items = analytics.recurringItems;
  const totalMonthly = items.reduce((s, i) => s + i.monthlyCost, 0);
  const cancelableCount = items.filter((i) => i.subscriptionClass === 'cancelable').length;
  const essentialCount = items.filter((i) => i.subscriptionClass === 'essential').length;
  const hikedCount = items.filter((i) => (i.priceIncreasePct ?? 0) > 0).length;

  const annualProjection = useMemo(
    () => computeSubscriptionAnnualProjection(items),
    [items]
  );

  const annualizedIncome = analytics.avgMonthlyIncome * 12;
  const activeProjectedAnnual =
    projectionScenario === 'baseline'
      ? annualProjection.totalAnnualBaseline
      : annualProjection.optimizedAnnual;
  const incomeSharePct =
    annualizedIncome > 0 ? (activeProjectedAnnual / annualizedIncome) * 100 : null;

  const essentialSharePct =
    annualProjection.totalAnnualBaseline > 0
      ? (annualProjection.essentialAnnual / annualProjection.totalAnnualBaseline) * 100
      : 0;
  const cancelableSharePct =
    annualProjection.totalAnnualBaseline > 0
      ? (annualProjection.cancelableAnnual / annualProjection.totalAnnualBaseline) * 100
      : 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'cancelable' && item.subscriptionClass !== 'cancelable') return false;
      if (filter === 'essential' && item.subscriptionClass !== 'essential') return false;
      if (filter === 'hiked' && !(item.priceIncreasePct && item.priceIncreasePct > 0)) return false;
      if (q) {
        const hay = `${item.merchant} ${item.categoryLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, search]);

  // Detect category overlap (e.g. multiple subscriptions in Subscriptions & Memberships)
  const discretionarySubCount = items.filter(
    (i) => i.categoryId === 'subscriptions'
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Recurring Subscriptions
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{items.length} recurring charges auto-detected locally</span>
            <span aria-hidden="true">·</span>
            <span>Mark each item Essential or Cancelable to refine your savings forecast</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onNavigateWealth}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Invest {formatMoney(analytics.cancelableRecurringMonthly, currency)}/mo in Cash ISA
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Detected Recurring
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(totalMonthly, currency, 2)}
            <span className="text-sm font-normal text-slate-500">/mo</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            {formatMoney(totalMonthly * 12, currency)}/yr across {items.length} bills
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Essential Recurring
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(analytics.essentialRecurringMonthly, currency, 2)}
            <span className="text-sm font-normal text-slate-500">/mo</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {essentialCount} locked as essential bills
          </p>
        </div>

        <div className="p-5 bg-teal-50/50 dark:bg-teal-950/20">
          <p className="text-xs font-medium text-teal-800 dark:text-teal-300">
            Cancelable Monthly Savings
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-teal-700 dark:text-teal-400">
            +{formatMoney(analytics.cancelableRecurringMonthly, currency, 2)}
            <span className="text-sm font-normal text-teal-700/80 dark:text-teal-400/80">/mo</span>
          </p>
          <p className="mt-1 text-xs text-teal-800/80 dark:text-teal-300/80 font-mono-num">
            {cancelableCount} subscription{cancelableCount === 1 ? '' : 's'} marked cancelable
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Annualized Subscription Savings
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(analytics.cancelableRecurringMonthly * 12, currency)}
            <span className="text-sm font-normal text-slate-500">/yr</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {hikedCount > 0 ? `${hikedCount} bill${hikedCount === 1 ? '' : 's'} rose in price over 12m` : 'No price hikes detected'}
          </p>
        </div>
      </div>

      {/* 12-Month Recurring Expenditure Projection Card */}
      <section
        aria-label="12-month recurring expenditure projection"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                12-Month Recurring Expenditure Projection
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {annualProjection.horizonLabel} · Estimated annual outflow from{' '}
              <span className="font-mono-num">{annualProjection.itemCount}</span> detected subscription habit
              {annualProjection.itemCount === 1 ? '' : 's'}
            </p>
          </div>

          {items.length > 0 && (
            <div
              className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start sm:self-auto"
              role="group"
              aria-label="12-month projection scenario"
            >
              <button
                type="button"
                aria-pressed={projectionScenario === 'baseline'}
                onClick={() => setProjectionScenario('baseline')}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  projectionScenario === 'baseline'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Current Habits
              </button>
              <button
                type="button"
                aria-pressed={projectionScenario === 'optimized'}
                onClick={() => setProjectionScenario('optimized')}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  projectionScenario === 'optimized'
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                If Cancelable Cut
              </button>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
            Upload at least two months of bank statements to detect recurring habits and project your 12-month subscription commitment.
          </div>
        ) : (
          <>
            {/* Projection Summary Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {projectionScenario === 'baseline'
                    ? 'Projected 12-Month Commitment'
                    : 'Lean 12-Month Commitment'}
                </p>
                <p className="mt-1.5 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
                  {formatMoney(activeProjectedAnnual, currency, 2)}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                  {formatMoney(activeProjectedAnnual / 12, currency, 2)}/mo avg
                  {incomeSharePct !== null && (
                    <span> · {incomeSharePct.toFixed(1)}% of annual income</span>
                  )}
                </p>
              </div>

              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-500 dark:text-slate-400">
                    Annual Habit Mix
                  </span>
                  <span className="font-mono-num text-slate-600 dark:text-slate-300">
                    {essentialSharePct.toFixed(0)}% Essential · {cancelableSharePct.toFixed(0)}% Cancelable
                  </span>
                </div>
                <div
                  className="mt-2.5 h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden flex"
                  aria-label={`Essential ${essentialSharePct.toFixed(0)}%, Cancelable ${cancelableSharePct.toFixed(0)}%`}
                >
                  <div
                    className="h-full bg-teal-700 dark:bg-teal-500 transition-all"
                    style={{ width: `${essentialSharePct}%` }}
                  />
                  {projectionScenario === 'baseline' && (
                    <div
                      className="h-full bg-amber-500 dark:bg-amber-400 transition-all"
                      style={{ width: `${cancelableSharePct}%` }}
                    />
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs font-mono-num text-slate-600 dark:text-slate-400">
                  <span>
                    Essential:{' '}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {formatMoney(annualProjection.essentialAnnual, currency, 2)}
                    </strong>
                  </span>
                  <span>
                    Cancelable:{' '}
                    <strong className="text-amber-700 dark:text-amber-400">
                      {formatMoney(annualProjection.cancelableAnnual, currency, 2)}
                    </strong>
                  </span>
                </div>
              </div>

              <div
                className={`p-4 rounded-lg border ${
                  projectionScenario === 'optimized' || annualProjection.cancelableAnnual > 0
                    ? 'bg-teal-50/50 dark:bg-teal-950/20 border-teal-200/80 dark:border-teal-900/60'
                    : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200/80 dark:border-slate-800'
                }`}
              >
                <p className="text-xs font-medium text-teal-800 dark:text-teal-300">
                  12-Month Reclaimable Cash
                </p>
                <p className="mt-1.5 text-2xl font-semibold font-mono-num text-teal-700 dark:text-teal-400">
                  {formatMoney(annualProjection.cancelableAnnual, currency, 2)}
                </p>
                {annualProjection.priceHikeDriftAnnual > 0 ? (
                  <p className="mt-1 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-mono-num">
                      +{formatMoney(annualProjection.priceHikeDriftAnnual, currency, 2)}/yr
                    </span>{' '}
                    if {annualProjection.hikedCount} price hike
                    {annualProjection.hikedCount === 1 ? '' : 's'} repeat
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-teal-800/80 dark:text-teal-300/80">
                    {cancelableCount > 0
                      ? `Cutting ${cancelableCount} cancelable habit${cancelableCount === 1 ? '' : 's'} drops annual spend to ${formatMoney(annualProjection.optimizedAnnual, currency, 2)}`
                      : 'All detected subscriptions are marked Essential'}
                  </p>
                )}
              </div>
            </div>

            {/* 12-Month Projection Bar Chart + Top Annual Habit Drivers */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-8">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Month-by-Month Recurring Outflow Forecast
                  </p>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-teal-700 dark:bg-teal-500 inline-block" />
                      Essential
                    </span>
                    {projectionScenario === 'baseline' && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                        Cancelable
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={annualProjection.months}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.6} />
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
                        width={56}
                        tickFormatter={(val: number) => formatMoney(val, currency, 0)}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const pt = payload[0].payload as SubscriptionProjectionMonth;
                          const shownMonthTotal =
                            projectionScenario === 'baseline' ? pt.total : pt.essential;
                          const shownCumulative =
                            projectionScenario === 'baseline'
                              ? pt.cumulativeBaseline
                              : pt.cumulativeOptimized;
                          return (
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-md text-xs space-y-1">
                              <p className="font-semibold text-slate-900 dark:text-slate-100">
                                {pt.label} (Month {pt.monthIndex}/12)
                              </p>
                              <div className="flex items-center justify-between gap-4 font-mono-num">
                                <span className="text-slate-500 dark:text-slate-400">Essential:</span>
                                <span className="text-slate-900 dark:text-slate-100">
                                  {formatMoney(pt.essential, currency, 2)}
                                </span>
                              </div>
                              {projectionScenario === 'baseline' && (
                                <div className="flex items-center justify-between gap-4 font-mono-num">
                                  <span className="text-amber-700 dark:text-amber-400">Cancelable:</span>
                                  <span className="text-amber-700 dark:text-amber-400">
                                    {formatMoney(pt.cancelable, currency, 2)}
                                  </span>
                                </div>
                              )}
                              <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 font-mono-num font-semibold">
                                <span className="text-slate-600 dark:text-slate-300">Month Total:</span>
                                <span className="text-slate-900 dark:text-slate-100">
                                  {formatMoney(shownMonthTotal, currency, 2)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4 font-mono-num text-[11px] text-teal-700 dark:text-teal-400">
                                <span>Cumulative YTD:</span>
                                <span>{formatMoney(shownCumulative, currency, 2)}</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="essential"
                        stackId="sub"
                        fill="#0f766e"
                        radius={
                          projectionScenario === 'optimized' || annualProjection.cancelableAnnual === 0
                            ? [4, 4, 0, 0]
                            : [0, 0, 0, 0]
                        }
                      />
                      {projectionScenario === 'baseline' && (
                        <Bar
                          dataKey="cancelable"
                          stackId="sub"
                          fill="#f59e0b"
                          radius={[4, 4, 0, 0]}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="lg:col-span-4 space-y-2.5">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Top Annual Habit Categories
                </p>
                <div className="space-y-2.5">
                  {annualProjection.topCategories.slice(0, 5).map((cat) => {
                    const shownCatAnnual =
                      projectionScenario === 'baseline' ? cat.annualCost : cat.essentialAnnual;
                    const denom =
                      projectionScenario === 'baseline'
                        ? annualProjection.totalAnnualBaseline
                        : annualProjection.optimizedAnnual;
                    const pct = denom > 0 ? (shownCatAnnual / denom) * 100 : 0;
                    return (
                      <div key={cat.categoryId} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-700 dark:text-slate-300 truncate">
                            {cat.categoryLabel}{' '}
                            <span className="text-slate-400 font-mono-num">({cat.itemCount})</span>
                          </span>
                          <span className="font-mono-num font-medium text-slate-900 dark:text-slate-100 shrink-0">
                            {formatMoney(shownCatAnnual, currency, 2)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-teal-700/80 dark:bg-teal-500/80 transition-all"
                            style={{ width: `${Math.min(100, Math.max(pct, shownCatAnnual > 0 ? 3 : 0))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Overlap Insight Callout (clean hairline container, no thick left border) */}
      {discretionarySubCount >= 4 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Repeat className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              <strong className="text-slate-900 dark:text-slate-100">
                Subscription overlap detected:
              </strong>{' '}
              Your statements show {discretionarySubCount} active discretionary subscriptions &amp; memberships billed every month. Marking duplicate streaming or gym memberships as <strong>Cancelable</strong> updates your monthly savings and Cash ISA forecast immediately.
            </div>
          </div>
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter recurring merchants or categories..."
            className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
        </div>

        <div className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto max-w-full">
          {(
            [
              { id: 'all', label: `All (${items.length})` },
              { id: 'cancelable', label: `Cancelable (${cancelableCount})` },
              { id: 'essential', label: `Essential (${essentialCount})` },
              { id: 'hiked', label: `Price Hikes (${hikedCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filter === tab.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Recurring Subscriptions Table (Desktop) + Touch List (Mobile) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No recurring subscriptions match this filter.
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4">Merchant &amp; Category</th>
                    <th className="py-3 px-4">Cadence &amp; History</th>
                    <th className="py-3 px-4 text-right">Monthly</th>
                    <th className="py-3 px-4 text-right">Annual</th>
                    <th className="py-3 px-4 text-right w-56">Classification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                  {filtered.map((item) => {
                    const isCancelable = item.subscriptionClass === 'cancelable';
                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            {item.merchant}
                          </p>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <span>{item.categoryLabel}</span>
                            {item.priceIncreasePct && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                                  <AlertTriangle className="w-3 h-3" />
                                  Price up +{item.priceIncreasePct}%
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                          <p>{item.cadence} · {item.occurrences} charges</p>
                          <p className="font-mono-num text-slate-400 mt-0.5">
                            Last billed {item.lastDate}
                          </p>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatMoney(item.monthlyCost, currency, 2)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {formatMoney(item.annualCost, currency)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div
                            className="inline-flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg"
                            role="group"
                            aria-label={`Classification for ${item.merchant}`}
                          >
                            <button
                              type="button"
                              onClick={() => onSetSubscriptionClass(item.id, 'essential')}
                              className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                !isCancelable
                                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                              }`}
                            >
                              Essential
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetSubscriptionClass(item.id, 'cancelable')}
                              className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                isCancelable
                                  ? 'bg-teal-700 text-white shadow-xs'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                              }`}
                            >
                              Cancelable
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Touch Rows */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((item) => {
                const isCancelable = item.subscriptionClass === 'cancelable';
                return (
                  <div key={item.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {item.merchant}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {item.categoryLabel} · {item.occurrences} charges
                          {item.priceIncreasePct ? ` · Up +${item.priceIncreasePct}%` : ''}
                        </p>
                      </div>
                      <div className="text-right font-mono-num shrink-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {formatMoney(item.monthlyCost, currency, 2)}/mo
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatMoney(item.annualCost, currency)}/yr
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                      <button
                        type="button"
                        onClick={() => onSetSubscriptionClass(item.id, 'essential')}
                        className={`min-h-[40px] text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          !isCancelable
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Essential
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetSubscriptionClass(item.id, 'cancelable')}
                        className={`min-h-[40px] text-xs font-medium rounded-md transition-colors cursor-pointer ${
                          isCancelable
                            ? 'bg-teal-700 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Cancelable
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
