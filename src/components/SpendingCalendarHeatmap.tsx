import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  CATEGORIES,
  formatMoney,
  getTransactionDisplayAmount,
  type CurrencyCode,
  type ExchangeRateTable,
  type Transaction,
} from '../types/finance';
import { formatMonthLabel } from '../utils/analyticsEngine';

interface SpendingCalendarHeatmapProps {
  transactions: Transaction[];
  currency: CurrencyCode;
  exchangeRates?: Partial<ExchangeRateTable>;
}

interface DaySummary {
  dateKey: string; // YYYY-MM-DD
  dayNum: number;
  totalSpent: number;
  nonEssentialSpent: number;
  txCount: number;
  transactions: Transaction[];
}

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const SpendingCalendarHeatmap: React.FC<SpendingCalendarHeatmapProps> = ({
  transactions,
  currency,
  exchangeRates,
}) => {
  const availableMonths = useMemo(() => {
    return Array.from(new Set(transactions.map((t) => t.date.slice(0, 7))))
      .sort()
      .reverse();
  }, [transactions]);

  const [selectedMonth, setSelectedMonth] = useState<string>(
    () => availableMonths[0] ?? ''
  );
  const [scope, setScope] = useState<'all' | 'non-essential'>('all');
  const [metric, setMetric] = useState<'amount' | 'volume'>('amount');
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const activeMonth = availableMonths.includes(selectedMonth)
    ? selectedMonth
    : (availableMonths[0] ?? '');

  const activeMonthIdx = availableMonths.indexOf(activeMonth);

  const calendarData = useMemo(() => {
    if (!activeMonth) {
      return {
        leadingEmpty: 0,
        days: [] as DaySummary[],
        maxValue: 0,
        avgActiveDayValue: 0,
        noSpendDays: 0,
        busiestDay: null as DaySummary | null,
        highestSpendDay: null as DaySummary | null,
        excessiveDaysCount: 0,
        totalMonthSpend: 0,
        totalMonthTx: 0,
      };
    }

    const [yStr, mStr] = activeMonth.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    // Monday-first weekday offset (0 = Mon ... 6 = Sun)
    const firstWeekdayJs = new Date(year, month - 1, 1).getDay();
    const leadingEmpty = (firstWeekdayJs + 6) % 7;

    const map = new Map<string, DaySummary>();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${activeMonth}-${String(d).padStart(2, '0')}`;
      map.set(dateKey, {
        dateKey,
        dayNum: d,
        totalSpent: 0,
        nonEssentialSpent: 0,
        txCount: 0,
        transactions: [],
      });
    }

    for (const tx of transactions) {
      if (!tx.date.startsWith(activeMonth)) continue;
      if (tx.spendingClass === 'income' || tx.spendingClass === 'savings' || tx.amount >= 0) {
        continue;
      }
      if (scope === 'non-essential' && tx.spendingClass !== 'non-essential') {
        continue;
      }
      const bucket = map.get(tx.date);
      if (!bucket) continue;
      const absAmt = Math.abs(
        getTransactionDisplayAmount(tx, currency, exchangeRates)
      );
      bucket.totalSpent += absAmt;
      if (tx.spendingClass === 'non-essential') {
        bucket.nonEssentialSpent += absAmt;
      }
      bucket.txCount += 1;
      bucket.transactions.push(tx);
    }

    const days = Array.from(map.values());
    for (const d of days) {
      d.transactions.sort(
        (a, b) =>
          Math.abs(getTransactionDisplayAmount(b, currency, exchangeRates)) -
          Math.abs(getTransactionDisplayAmount(a, currency, exchangeRates))
      );
    }

    const values = days.map((d) => (metric === 'amount' ? d.totalSpent : d.txCount));
    const maxValue = values.reduce((m, v) => Math.max(m, v), 0);
    const activeValues = values.filter((v) => v > 0);
    const avgActiveDayValue =
      activeValues.length > 0
        ? activeValues.reduce((s, v) => s + v, 0) / activeValues.length
        : 0;

    let noSpendDays = 0;
    let busiestDay: DaySummary | null = null;
    let highestSpendDay: DaySummary | null = null;
    let excessiveDaysCount = 0;
    let totalMonthSpend = 0;
    let totalMonthTx = 0;

    for (const d of days) {
      totalMonthSpend += d.totalSpent;
      totalMonthTx += d.txCount;
      if (d.txCount === 0) {
        noSpendDays++;
      } else {
        if (!busiestDay || d.txCount > busiestDay.txCount || (d.txCount === busiestDay.txCount && d.totalSpent > busiestDay.totalSpent)) {
          busiestDay = d;
        }
        if (!highestSpendDay || d.totalSpent > highestSpendDay.totalSpent) {
          highestSpendDay = d;
        }
        const val = metric === 'amount' ? d.totalSpent : d.txCount;
        const isExcessive =
          metric === 'volume'
            ? d.txCount >= 3 || (avgActiveDayValue > 0 && val >= avgActiveDayValue * 1.5)
            : avgActiveDayValue > 0 && val >= avgActiveDayValue * 1.6;
        if (isExcessive) excessiveDaysCount++;
      }
    }

    return {
      leadingEmpty,
      days,
      maxValue,
      avgActiveDayValue,
      noSpendDays,
      busiestDay,
      highestSpendDay,
      excessiveDaysCount,
      totalMonthSpend,
      totalMonthTx,
    };
  }, [transactions, activeMonth, scope, metric, currency, exchangeRates]);

  const activeDay: DaySummary | null = useMemo(() => {
    if (selectedDayKey) {
      const found = calendarData.days.find((d) => d.dateKey === selectedDayKey);
      if (found) return found;
    }
    return metric === 'volume'
      ? calendarData.busiestDay
      : calendarData.highestSpendDay;
  }, [selectedDayKey, calendarData, metric]);

  const getIntensityLevel = (day: DaySummary): 0 | 1 | 2 | 3 | 4 => {
    const val = metric === 'amount' ? day.totalSpent : day.txCount;
    if (val <= 0 || calendarData.maxValue <= 0) return 0;
    const ratio = val / calendarData.maxValue;
    if (ratio >= 0.72) return 4;
    if (ratio >= 0.45) return 3;
    if (ratio >= 0.2) return 2;
    return 1;
  };

  const levelClasses: Record<0 | 1 | 2 | 3 | 4, string> = {
    0: 'bg-slate-50 dark:bg-slate-950/70 border-slate-200/80 dark:border-slate-800 text-slate-400 dark:text-slate-600',
    1: 'bg-teal-50 dark:bg-teal-950/40 border-teal-200/70 dark:border-teal-900/70 text-teal-900 dark:text-teal-200',
    2: 'bg-amber-100/80 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900/80 text-amber-950 dark:text-amber-200',
    3: 'bg-amber-300/80 dark:bg-amber-800/70 border-amber-400 dark:border-amber-700 text-amber-950 dark:text-amber-50',
    4: 'bg-red-500/85 dark:bg-red-700/85 border-red-600 dark:border-red-500 text-white',
  };

  if (!activeMonth) return null;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
      {/* Header + Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Daily Spending Intensity Calendar
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Spot high-spend spikes, excessive transaction volume days, and zero-spend streaks
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Metric Mode Toggle */}
          <div
            className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
            role="group"
            aria-label="Heatmap intensity metric"
          >
            <button
              type="button"
              onClick={() => setMetric('amount')}
              className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                metric === 'amount'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Spend Amount
            </button>
            <button
              type="button"
              onClick={() => setMetric('volume')}
              className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                metric === 'volume'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Tx Volume
            </button>
          </div>

          {/* Scope Toggle */}
          <div
            className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg"
            role="group"
            aria-label="Spending scope"
          >
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                scope === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              All Spending
            </button>
            <button
              type="button"
              onClick={() => setScope('non-essential')}
              className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                scope === 'non-essential'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Non-Essential
            </button>
          </div>

          {/* Month Navigation */}
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              disabled={activeMonthIdx >= availableMonths.length - 1}
              onClick={() => {
                const prev = availableMonths[activeMonthIdx + 1];
                if (prev) {
                  setSelectedMonth(prev);
                  setSelectedDayKey(null);
                }
              }}
              className="min-w-[34px] min-h-[34px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <select
              aria-label="Select heatmap month"
              value={activeMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setSelectedDayKey(null);
              }}
              className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-800 dark:text-slate-200"
            >
              {availableMonths.map((mk) => (
                <option key={mk} value={mk}>
                  {formatMonthLabel(mk)}
                </option>
              ))}
            </select>

            <button
              type="button"
              aria-label="Next month"
              disabled={activeMonthIdx <= 0}
              onClick={() => {
                const next = availableMonths[activeMonthIdx - 1];
                if (next) {
                  setSelectedMonth(next);
                  setSelectedDayKey(null);
                }
              }}
              className="min-w-[34px] min-h-[34px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Month Summary Strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400 pb-3 border-b border-slate-100 dark:border-slate-800">
        <span>
          Zero-spend days:{' '}
          <strong className="font-mono-num text-teal-700 dark:text-teal-400">
            {calendarData.noSpendDays}
          </strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          High-intensity days:{' '}
          <strong className="font-mono-num text-amber-700 dark:text-amber-400">
            {calendarData.excessiveDaysCount}
          </strong>
        </span>
        {calendarData.busiestDay && (
          <>
            <span aria-hidden="true">·</span>
            <span>
              Busiest day:{' '}
              <strong className="font-mono-num text-slate-900 dark:text-slate-100">
                {calendarData.busiestDay.dateKey} ({calendarData.busiestDay.txCount} tx ·{' '}
                {formatMoney(calendarData.busiestDay.totalSpent, currency)})
              </strong>
            </span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span>
          Month total:{' '}
          <strong className="font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(calendarData.totalMonthSpend, currency)} ({calendarData.totalMonthTx} tx)
          </strong>
        </span>
      </div>

      {/* Calendar Grid + Selected Day Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-3">
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {WEEKDAY_HEADERS.map((wd) => (
              <div key={wd} className="py-1">
                {wd}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: calendarData.leadingEmpty }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square sm:aspect-auto sm:h-14" />
            ))}

            {calendarData.days.map((day) => {
              const level = getIntensityLevel(day);
              const isSelected = activeDay?.dateKey === day.dateKey;
              return (
                <button
                  key={day.dateKey}
                  type="button"
                  onClick={() => setSelectedDayKey(day.dateKey)}
                  aria-label={`${day.dateKey}: ${day.txCount} transactions, ${formatMoney(day.totalSpent, currency)}`}
                  className={`min-h-[48px] sm:h-14 p-1.5 rounded-lg border text-left flex flex-col justify-between transition-all cursor-pointer ${
                    levelClasses[level]
                  } ${
                    isSelected
                      ? 'ring-2 ring-slate-900 dark:ring-white ring-offset-1 dark:ring-offset-slate-900'
                      : 'hover:opacity-90'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-[11px] font-mono-num font-semibold leading-none">
                      {day.dayNum}
                    </span>
                    {day.txCount > 0 && (
                      <span className="text-[10px] font-mono-num opacity-85 leading-none">
                        {day.txCount}×
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono-num truncate leading-none">
                    {day.totalSpent > 0 ? formatMoney(day.totalSpent, currency) : '—'}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Intensity Scale Legend */}
          <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Click any day to inspect transactions</span>
            <div className="flex items-center gap-1.5">
              <span>No spend</span>
              <span className="w-3.5 h-3.5 rounded-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 inline-block" />
              <span className="w-3.5 h-3.5 rounded-xs bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-900 inline-block" />
              <span className="w-3.5 h-3.5 rounded-xs bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900 inline-block" />
              <span className="w-3.5 h-3.5 rounded-xs bg-amber-300 dark:bg-amber-800 border border-amber-400 dark:border-amber-700 inline-block" />
              <span className="w-3.5 h-3.5 rounded-xs bg-red-500/85 dark:bg-red-700/85 border border-red-600 dark:border-red-500 inline-block" />
              <span>Peak</span>
            </div>
          </div>
        </div>

        {/* Selected Day Transaction Breakdown */}
        <div className="lg:col-span-5 rounded-xl bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
          {activeDay ? (
            <>
              <div className="flex items-baseline justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-800">
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 font-mono-num">
                    {activeDay.dateKey}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {activeDay.txCount === 0
                      ? 'Zero-spend day'
                      : `${activeDay.txCount} transaction${activeDay.txCount === 1 ? '' : 's'} · ${formatMoney(activeDay.nonEssentialSpent, currency)} non-essential`}
                  </p>
                </div>
                <span className="text-base font-semibold font-mono-num text-slate-900 dark:text-slate-100">
                  {formatMoney(activeDay.totalSpent, currency, 2)}
                </span>
              </div>

              {activeDay.transactions.length === 0 ? (
                <p className="py-4 text-xs text-teal-700 dark:text-teal-400">
                  No outgoing expenses recorded on this day. Zero-spend days help pull monthly totals back inside your caps.
                </p>
              ) : (
                <ul className="divide-y divide-slate-200/70 dark:divide-slate-800 max-h-64 overflow-y-auto">
                  {activeDay.transactions.map((tx) => {
                    const txCurr = tx.currency ?? currency;
                    const displayAmt = Math.abs(
                      getTransactionDisplayAmount(tx, currency, exchangeRates)
                    );
                    const isForeign = txCurr !== currency;
                    return (
                      <li
                        key={tx.id}
                        className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {tx.merchant}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {CATEGORIES[tx.category].label} ·{' '}
                            <span
                              className={
                                tx.spendingClass === 'non-essential'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }
                            >
                              {tx.spendingClass === 'essential' ? 'Essential' : 'Non-Essential'}
                            </span>
                          </p>
                        </div>
                        <div className="text-right font-mono-num shrink-0">
                          <p className="font-medium text-slate-900 dark:text-slate-100">
                            {formatMoney(displayAmt, currency, 2)}
                          </p>
                          {isForeign && (
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              {formatMoney(Math.abs(tx.amount), txCurr, 2)}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Select a day on the calendar to view its transactions.
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
