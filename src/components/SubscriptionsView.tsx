import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Repeat,
  Search,
} from 'lucide-react';
import {
  formatMoney,
  type CurrencyCode,
  type SubscriptionClass,
} from '../types/finance';
import type { AnalyticsResult } from '../utils/analyticsEngine';

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

  const items = analytics.recurringItems;
  const totalMonthly = items.reduce((s, i) => s + i.monthlyCost, 0);
  const cancelableCount = items.filter((i) => i.subscriptionClass === 'cancelable').length;
  const essentialCount = items.filter((i) => i.subscriptionClass === 'essential').length;
  const hikedCount = items.filter((i) => (i.priceIncreasePct ?? 0) > 0).length;

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
