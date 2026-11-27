import React from 'react';
import { ArrowRight, Check, AlertTriangle } from 'lucide-react';
import { formatMoney, type CurrencyCode } from '../types/finance';
import type { AnalyticsResult } from '../utils/analyticsEngine';

interface CutSavingsViewProps {
  analytics: AnalyticsResult;
  currency: CurrencyCode;
  onToggleRecommendation: (id: string, enabled: boolean, activeCutPct: number) => void;
  onSetRecurringAction: (recId: string, action: 'keep' | 'downgrade' | 'cancel') => void;
  onNavigateWealth: () => void;
}

export const CutSavingsView: React.FC<CutSavingsViewProps> = ({
  analytics,
  currency,
  onToggleRecommendation,
  onSetRecurringAction,
  onNavigateWealth,
}) => {
  const annualUnlocked = analytics.totalRecommendedMonthlySavings * 12;
  const newMonthlySurplus =
    analytics.avgMonthlySurplus + analytics.totalRecommendedMonthlySavings;
  const newSavingsRate =
    analytics.avgMonthlyIncome > 0
      ? (newMonthlySurplus / analytics.avgMonthlyIncome) * 100
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Cut &amp; Save Optimizer
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Interactive savings targets derived from your {analytics.monthCount}-month transaction history
          </p>
        </div>

        <button
          type="button"
          onClick={onNavigateWealth}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Allocate {formatMoney(newMonthlySurplus, currency)}/mo to Cash ISA
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Impact Summary Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Monthly Savings Unlocked
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-teal-700 dark:text-teal-400">
            +{formatMoney(analytics.totalRecommendedMonthlySavings, currency)}
            <span className="text-sm font-normal text-slate-500">/mo</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            {formatMoney(analytics.unlockedMonthlyFromCuts, currency)} habits ·{' '}
            {formatMoney(analytics.unlockedMonthlyFromRecurring, currency)} bills &amp; subs
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Annualized Cash Freed
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(annualUnlocked, currency)}
            <span className="text-sm font-normal text-slate-500">/yr</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Before Cash ISA tax-free interest
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Projected Savings Rate
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {newSavingsRate.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            Up from {analytics.savingsRatePct.toFixed(1)}% ({formatMoney(newMonthlySurplus, currency)}/mo total pot)
          </p>
        </div>
      </div>

      {/* Two-Column Interactive Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Personalized Category Cut Recommendations */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Personalized Monthly Cut Scenarios
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Toggle each recommendation and dial the reduction slider to fit your real lifestyle
            </p>
          </div>

          {analytics.recommendations.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              Upload bank statements with discretionary spending to generate personalized cut scenarios.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {analytics.recommendations.map((rec) => {
                const monthlySaved = rec.enabled
                  ? rec.currentMonthly * (rec.activeCutPct / 100)
                  : 0;
                const newMonthlyBudget = rec.currentMonthly - monthlySaved;

                return (
                  <div key={rec.id} className="py-5 first:pt-2 last:pb-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={rec.enabled}
                          aria-label={`Toggle ${rec.title}`}
                          onClick={() =>
                            onToggleRecommendation(rec.id, !rec.enabled, rec.activeCutPct)
                          }
                          className={`mt-0.5 w-6 h-6 min-w-[24px] rounded-md border flex items-center justify-center transition-colors cursor-pointer ${
                            rec.enabled
                              ? 'bg-teal-700 border-teal-700 text-white'
                              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950'
                          }`}
                        >
                          {rec.enabled && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                        </button>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {rec.title}
                          </h3>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                            {rec.rationale}
                          </p>
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                            <span>Current avg: {formatMoney(rec.currentMonthly, currency)}/mo</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span>New cap: {formatMoney(newMonthlyBudget, currency)}/mo</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span>{rec.effort}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0 font-mono-num">
                        <p
                          className={`text-base font-semibold ${
                            rec.enabled
                              ? 'text-teal-700 dark:text-teal-400'
                              : 'text-slate-400 dark:text-slate-600'
                          }`}
                        >
                          +{formatMoney(monthlySaved, currency)}
                          <span className="text-xs font-normal">/mo</span>
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatMoney(monthlySaved * 12, currency)}/yr
                        </p>
                      </div>
                    </div>

                    {/* Interactive Cut Slider */}
                    <div className="mt-3 pl-9 flex items-center gap-4">
                      <label
                        htmlFor={`slider-${rec.id}`}
                        className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0 w-24"
                      >
                        Trim by <strong className="font-mono-num text-slate-800 dark:text-slate-200">{rec.activeCutPct}%</strong>
                      </label>
                      <input
                        id={`slider-${rec.id}`}
                        type="range"
                        min={5}
                        max={85}
                        step={5}
                        value={rec.activeCutPct}
                        onChange={(e) =>
                          onToggleRecommendation(rec.id, true, Number(e.target.value))
                        }
                        className="flex-1 h-2 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recurring Subscriptions & Stealth Price Hikes Auditor */}
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Recurring Bills &amp; Subscription Audit
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Mark overlapping subscriptions to cancel or renegotiate (downgrade estimates 35% saving)
            </p>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {analytics.recurringItems.map((item) => {
              const saved =
                item.action === 'cancel'
                  ? item.monthlyCost
                  : item.action === 'downgrade'
                    ? item.monthlyCost * 0.35
                    : 0;

              return (
                <div key={item.id} className="py-3.5 first:pt-1 last:pb-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {item.merchant}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <span>{item.spendingClass === 'essential' ? 'Essential bill' : 'Subscription'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num">{formatMoney(item.annualCost, currency)}/yr</span>
                        {item.priceIncreasePct && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                              <AlertTriangle className="w-3 h-3" />
                              Up {item.priceIncreasePct}%
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 font-mono-num">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formatMoney(item.monthlyCost, currency, 2)}
                      </p>
                      {saved > 0 && (
                        <p className="text-xs font-medium text-teal-700 dark:text-teal-400">
                          Save {formatMoney(saved, currency, 2)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Action Segmented Control */}
                  <div className="mt-2.5 inline-flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    {(
                      [
                        { id: 'keep', label: 'Keep' },
                        { id: 'downgrade', label: 'Negotiate (-35%)' },
                        { id: 'cancel', label: 'Cancel' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onSetRecurringAction(item.id, opt.id)}
                        className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          item.action === opt.id
                            ? opt.id === 'cancel'
                              ? 'bg-red-600 text-white shadow-xs'
                              : opt.id === 'downgrade'
                                ? 'bg-teal-700 text-white shadow-xs'
                                : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};
