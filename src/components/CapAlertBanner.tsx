import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { formatMoney, type CapPaceAlert, type CurrencyCode } from '../types/finance';

interface CapAlertBannerProps {
  alerts: CapPaceAlert[];
  currency: CurrencyCode;
  onDismiss: () => void;
  onReviewCaps: () => void;
}

export const CapAlertBanner: React.FC<CapAlertBannerProps> = ({
  alerts,
  currency,
  onDismiss,
  onReviewCaps,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (alerts.length === 0) return null;

  const top = alerts[0];
  const totalProjectedOverage = alerts.reduce((s, a) => s + a.projectedOverage, 0);
  const formatAlertMoney = (val: number, forcePence = false) => {
    const hasPence = Math.abs(val - Math.round(val)) >= 0.005;
    const needsPence = forcePence || (hasPence && (Math.abs(val) < 10 || Math.round(val) === 0));
    return formatMoney(val, currency, needsPence ? 2 : 0);
  };
  const topNeedsPence = top.projectedOverage > 0 && Math.round(top.projectedOverage) === 0;

  return (
    <div
      role="alert"
      className="mb-6 bg-amber-50/90 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/80 rounded-xl p-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0 text-xs sm:text-sm">
            <p className="font-semibold text-amber-950 dark:text-amber-100">
              {alerts.length === 1
                ? `${top.label} is projected to exceed its monthly cap before month-end`
                : `${alerts.length} categories are projected to exceed their monthly caps before month-end`}
            </p>
            <p className="mt-0.5 text-xs text-amber-900/85 dark:text-amber-200/85 font-mono-num">
              {top.monthLabel} pace (day {top.elapsedDays}/{top.daysInMonth}
              {top.daysRemaining > 0 ? `, ${top.daysRemaining}d left` : ''}):{' '}
              {top.label} at {formatAlertMoney(top.spentToDate, topNeedsPence)} → projected{' '}
              {formatAlertMoney(top.projectedMonthEnd, topNeedsPence)} vs.{' '}
              {formatAlertMoney(top.monthlyCap)} cap
              {alerts.length > 1
                ? ` · +${formatAlertMoney(totalProjectedOverage)} total projected overage`
                : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {alerts.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300/80 dark:border-amber-700 text-xs font-medium text-amber-950 dark:text-amber-100 hover:bg-amber-100/80 dark:hover:bg-amber-900/40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>{expanded ? 'Hide Details' : `View All (${alerts.length})`}</span>
              {expanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onReviewCaps}
            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-amber-900 dark:bg-amber-400 text-white dark:text-slate-950 text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
          >
            Review Caps
          </button>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss cap pace notification"
            className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-lg text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && alerts.length > 1 && (
        <div className="mt-3 pt-3 border-t border-amber-200/80 dark:border-amber-800/70 divide-y divide-amber-200/60 dark:divide-amber-900/60 text-xs">
          {alerts.map((a) => {
            const rowNeedsPence = a.projectedOverage > 0 && Math.round(a.projectedOverage) === 0;
            return (
              <div
                key={a.categoryId}
                className="py-2 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-2"
              >
                <span className="font-medium text-amber-950 dark:text-amber-100">{a.label}</span>
                <span className="font-mono-num text-amber-900 dark:text-amber-200">
                  Spent {formatAlertMoney(a.spentToDate, rowNeedsPence)} · Projected{' '}
                  <strong>{formatAlertMoney(a.projectedMonthEnd, rowNeedsPence)}</strong> vs.{' '}
                  {formatAlertMoney(a.monthlyCap)} cap (+
                  {formatAlertMoney(a.projectedOverage, rowNeedsPence)} /{' '}
                  {Math.round(a.projectedPctOfCap)}%)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
