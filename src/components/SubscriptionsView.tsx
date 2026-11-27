import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Search,
  TrendingUp,
  X,
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
  computeSubscriptionCalendarMonth,
  type AnalyticsResult,
  type RecurringActionType,
  type SubscriptionProjectionMonth,
} from '../utils/analyticsEngine';

interface SubscriptionsViewProps {
  analytics: AnalyticsResult;
  currency: CurrencyCode;
  recurringActions?: Record<string, RecurringActionType>;
  onSetSubscriptionClass: (recId: string, nextClass: SubscriptionClass) => void;
  onSetRecurringAction?: (recId: string, action: RecurringActionType) => void;
  onNavigateWealth: () => void;
}

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getInitialCalendarMonth(items: AnalyticsResult['recurringItems']): {
  year: number;
  monthIndex: number;
} {
  // Default to the month following the latest detected billing date so upcoming charges are immediately visible
  const latest = items
    .map((i) => i.lastDate)
    .filter((d) => /^\d{4}-\d{2}/.test(d))
    .sort()
    .pop();
  if (latest) {
    const y = Number(latest.slice(0, 4));
    const m = Number(latest.slice(5, 7)); // 1..12
    const nextZeroBased = m; // m is already next month in 0-indexed JS months
    return {
      year: y + Math.floor(nextZeroBased / 12),
      monthIndex: nextZeroBased % 12,
    };
  }
  const now = new Date();
  return { year: now.getFullYear(), monthIndex: now.getMonth() };
}

export const SubscriptionsView: React.FC<SubscriptionsViewProps> = ({
  analytics,
  currency,
  recurringActions = {},
  onSetSubscriptionClass,
  onSetRecurringAction,
  onNavigateWealth,
}) => {
  const [filter, setFilter] = useState<'all' | 'cancelable' | 'essential' | 'hiked'>('all');
  const [search, setSearch] = useState('');
  const [projectionScenario, setProjectionScenario] = useState<'baseline' | 'optimized'>('baseline');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    getInitialCalendarMonth(analytics.recurringItems)
  );
  const [calendarActionFilter, setCalendarActionFilter] = useState<'all' | RecurringActionType>('all');
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const items = analytics.recurringItems;
  const totalMonthly = items.reduce((s, i) => s + i.monthlyCost, 0);
  const cancelableCount = items.filter((i) => i.subscriptionClass === 'cancelable').length;
  const essentialCount = items.filter((i) => i.subscriptionClass === 'essential').length;
  const hikedCount = items.filter((i) => (i.priceIncreasePct ?? 0) > 0).length;

  useEffect(() => {
    if (!calendarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCalendarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [calendarOpen]);

  const annualProjection = useMemo(
    () => computeSubscriptionAnnualProjection(items),
    [items]
  );

  const calendarData = useMemo(
    () =>
      computeSubscriptionCalendarMonth(
        items,
        recurringActions,
        calendarMonth.year,
        calendarMonth.monthIndex
      ),
    [items, recurringActions, calendarMonth.year, calendarMonth.monthIndex]
  );

  const filteredCalendarEvents = useMemo(() => {
    if (calendarActionFilter === 'all') return calendarData.events;
    return calendarData.events.filter((e) => e.action === calendarActionFilter);
  }, [calendarData.events, calendarActionFilter]);

  const filteredEventsByDay = useMemo(() => {
    const map: Record<number, typeof filteredCalendarEvents> = {};
    for (const evt of filteredCalendarEvents) {
      if (!map[evt.dayOfMonth]) map[evt.dayOfMonth] = [];
      map[evt.dayOfMonth].push(evt);
    }
    return map;
  }, [filteredCalendarEvents]);

  const shiftCalendarMonth = (delta: number) => {
    setCalendarMonth((prev) => {
      const total = prev.year * 12 + prev.monthIndex + delta;
      return {
        year: Math.floor(total / 12),
        monthIndex: ((total % 12) + 12) % 12,
      };
    });
    setSelectedDay(null);
  };

  const handleCalendarActionChange = (recId: string, nextAction: RecurringActionType) => {
    if (onSetRecurringAction) {
      onSetRecurringAction(recId, nextAction);
    } else {
      onSetSubscriptionClass(recId, nextAction === 'cancel' ? 'cancelable' : 'essential');
    }
  };

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

  const calendarCells = useMemo(() => {
    const cells: Array<{ day: number | null }> = [];
    for (let i = 0; i < calendarData.firstWeekdayMon0; i++) {
      cells.push({ day: null });
    }
    for (let d = 1; d <= calendarData.daysInMonth; d++) {
      cells.push({ day: d });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ day: null });
    }
    return cells;
  }, [calendarData.firstWeekdayMon0, calendarData.daysInMonth]);

  const detailEvents =
    selectedDay !== null ? (filteredEventsByDay[selectedDay] ?? []) : filteredCalendarEvents;

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

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setCalendarMonth(getInitialCalendarMonth(items));
              setSelectedDay(null);
              setCalendarOpen(true);
            }}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Calendar className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            Charge Calendar
          </button>

          <button
            type="button"
            onClick={onNavigateWealth}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Invest {formatMoney(analytics.cancelableRecurringMonthly, currency)}/mo in Cash ISA
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
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

      {/* Upcoming Subscription Charge Calendar Overlay */}
      {calendarOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sub-calendar-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCalendarOpen(false);
          }}
        >
          <div className="w-full max-w-5xl max-h-[92vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Overlay Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  <h2
                    id="sub-calendar-title"
                    className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 truncate"
                  >
                    Upcoming Subscription Charge Calendar
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Projected charge dates and what-if savings based on each bill&rsquo;s recurrence cadence and your planned Keep / Downgrade / Cancel choices. These choices do not change a provider bill.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => shiftCalendarMonth(-1)}
                    className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-3 text-xs font-semibold text-slate-900 dark:text-slate-100 min-w-[122px] text-center">
                    {calendarData.monthLabel}
                  </span>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => shiftCalendarMonth(1)}
                    className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  aria-label="Close subscription calendar overlay"
                  onClick={() => setCalendarOpen(false)}
                  className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Summary Strip + Action Filter */}
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  Baseline:{' '}
                  <strong className="font-mono-num text-slate-900 dark:text-slate-100">
                    {formatMoney(calendarData.totalScheduled, currency, 2)}
                  </strong>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  Projected If Choices Are Completed:{' '}
                  <strong className="font-mono-num text-teal-700 dark:text-teal-400">
                    {formatMoney(calendarData.activeScheduled, currency, 2)}
                  </strong>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  Potential Monthly Savings:{' '}
                  <strong className="font-mono-num text-emerald-700 dark:text-emerald-400">
                    +{formatMoney(calendarData.savedInMonth, currency, 2)}
                  </strong>
                </span>
              </div>

              <div
                className="inline-flex items-center p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-lg overflow-x-auto max-w-full"
                role="group"
                aria-label="Filter calendar by recurring action"
              >
                {(
                  [
                    { id: 'all', label: `All (${calendarData.events.length})` },
                    { id: 'keep', label: `Keep (${calendarData.keepCount})` },
                    { id: 'downgrade', label: `Downgrade (${calendarData.downgradeCount})` },
                    { id: 'cancel', label: `Cancel (${calendarData.cancelCount})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={calendarActionFilter === tab.id}
                    onClick={() => setCalendarActionFilter(tab.id)}
                    className={`min-h-[30px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      calendarActionFilter === tab.id
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Calendar Grid + Selected Day / Monthly Action Drawer */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-8 space-y-2">
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 pb-1">
                  {WEEKDAY_HEADERS.map((wd) => (
                    <div key={wd}>{wd}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1.5">
                  {calendarCells.map((cell, idx) => {
                    if (cell.day === null) {
                      return (
                        <div
                          key={`empty-${idx}`}
                          className="min-h-[74px] sm:min-h-[86px] rounded-lg bg-slate-50/50 dark:bg-slate-950/30 border border-transparent"
                        />
                      );
                    }
                    const day = cell.day;
                    const dayEvents = filteredEventsByDay[day] ?? [];
                    const dayTotal = dayEvents.reduce((s, e) => s + e.effectiveAmount, 0);
                    const isSelected = selectedDay === day;

                    return (
                      <button
                        key={`day-${day}`}
                        type="button"
                        onClick={() => setSelectedDay((prev) => (prev === day ? null : day))}
                        className={`min-h-[74px] sm:min-h-[86px] p-1.5 rounded-lg border text-left flex flex-col justify-between transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/30 ring-1 ring-teal-600/30'
                            : dayEvents.length > 0
                              ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-teal-600/50'
                              : 'border-slate-100 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/50 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 w-full">
                          <span
                            className={`text-xs font-mono-num ${
                              dayEvents.length > 0
                                ? 'font-semibold text-slate-900 dark:text-slate-100'
                                : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            {day}
                          </span>
                          {dayEvents.length > 0 && (
                            <span className="text-[10px] font-mono-num font-medium text-slate-500 dark:text-slate-400 truncate">
                              {formatMoney(dayTotal, currency, 0)}
                            </span>
                          )}
                        </div>

                        <div className="mt-1 space-y-0.5 w-full overflow-hidden">
                          {dayEvents.slice(0, 2).map((evt) => (
                            <div
                              key={evt.id}
                              title={`${evt.merchant} · ${formatMoney(evt.scheduledAmount, currency, 2)} (${evt.action})`}
                              className={`px-1 py-0.5 rounded text-[10px] font-medium truncate border ${
                                evt.action === 'cancel'
                                  ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-300 line-through opacity-80'
                                  : evt.action === 'downgrade'
                                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/70 text-amber-800 dark:text-amber-300'
                                    : 'bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/70 text-teal-800 dark:text-teal-300'
                              }`}
                            >
                              {evt.merchant}
                            </div>
                          ))}
                          {dayEvents.length > 2 && (
                            <p className="text-[10px] text-slate-400 font-mono-num pl-0.5">
                              +{dayEvents.length - 2} more
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right Panel: Selected Day or Full Month Schedule with Live Action Controls */}
              <div className="lg:col-span-4 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 pt-4 lg:pt-0 lg:pl-5 flex flex-col">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {selectedDay !== null
                      ? `Charges on ${calendarData.monthKey}-${String(selectedDay).padStart(2, '0')}`
                      : `All ${calendarData.monthLabel} Charges (${detailEvents.length})`}
                  </p>
                  {selectedDay !== null && (
                    <button
                      type="button"
                      onClick={() => setSelectedDay(null)}
                      className="text-xs text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                    >
                      Show full month
                    </button>
                  )}
                </div>

                {detailEvents.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                    No subscription charges scheduled for this selection.
                  </p>
                ) : (
                  <div className="space-y-2.5 overflow-y-auto max-h-[420px] pr-1">
                    {detailEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {evt.merchant}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                              {evt.date} · {evt.cadence}
                            </p>
                          </div>
                          <div className="text-right font-mono-num shrink-0">
                            <p
                              className={`text-xs font-semibold ${
                                evt.action === 'cancel'
                                  ? 'text-rose-600 dark:text-rose-400 line-through'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {formatMoney(evt.scheduledAmount, currency, 2)}
                            </p>
                            {evt.action === 'downgrade' && (
                              <p className="text-[10px] text-amber-700 dark:text-amber-400">
                                → {formatMoney(evt.effectiveAmount, currency, 2)}
                              </p>
                            )}
                          </div>
                        </div>

                        <div
                          className="grid grid-cols-3 gap-1 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-md"
                          role="group"
                          aria-label={`Action for ${evt.merchant}`}
                        >
                          {(
                            [
                              { id: 'keep', label: 'Keep' },
                              { id: 'downgrade', label: '-35%' },
                              { id: 'cancel', label: 'Cancel' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              aria-pressed={evt.action === opt.id}
                              onClick={() => handleCalendarActionChange(evt.recId, opt.id)}
                              className={`py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                                evt.action === opt.id
                                  ? opt.id === 'cancel'
                                    ? 'bg-rose-600 text-white'
                                    : opt.id === 'downgrade'
                                      ? 'bg-amber-600 text-white'
                                      : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
