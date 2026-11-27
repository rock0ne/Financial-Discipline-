import React from 'react';
import { ArrowRight, CalendarClock } from 'lucide-react';
import {
  formatMoney,
  type CurrencyCode,
  type UpcomingBillsSummary,
} from '../types/finance';

interface UpcomingBillsWidgetProps {
  summary: UpcomingBillsSummary;
  currency: CurrencyCode;
  onManageSubscriptions: () => void;
  onInspectLedger: () => void;
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatShortDueDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  return `${SHORT_WEEKDAYS[dt.getDay()]} ${d} ${SHORT_MONTHS[m - 1]}`;
}

function formatCountdown(daysUntilDue: number): string {
  if (daysUntilDue === 0) return 'Due today';
  if (daysUntilDue === 1) return 'Due tomorrow';
  return `In ${daysUntilDue} days`;
}

export const UpcomingBillsWidget: React.FC<UpcomingBillsWidgetProps> = ({
  summary,
  currency,
  onManageSubscriptions,
  onInspectLedger,
}) => {
  const {
    windowDays,
    referenceDate,
    windowEndDate,
    dueSoon,
    nextAfterWindow,
    totalDueSoon,
    essentialDueSoon,
    nonEssentialDueSoon,
    cancelableDueSoon,
  } = summary;

  return (
    <section
      aria-labelledby="upcoming-bills-heading"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4"
    >
      {/* Header + 7-Day Total */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <h2
              id="upcoming-bills-heading"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Upcoming Bills (Next {windowDays} Days)
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Projected from recurring ledger patterns · {formatShortDueDate(referenceDate)} –{' '}
            {formatShortDueDate(windowEndDate)}
          </p>
        </div>

        <div className="sm:text-right font-mono-num shrink-0">
          <p className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {formatMoney(totalDueSoon, currency, 2)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {dueSoon.length === 0
              ? 'Nothing due this week'
              : `${dueSoon.length} recurring bill${dueSoon.length === 1 ? '' : 's'} due`}
          </p>
        </div>
      </div>

      {/* Essential / Non-Essential / Cancelable Breakdown Strip */}
      {dueSoon.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 pb-3 border-b border-slate-100 dark:border-slate-800">
          <span>
            Essential:{' '}
            <strong className="font-mono-num text-slate-800 dark:text-slate-200">
              {formatMoney(essentialDueSoon, currency, 2)}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Non-Essential:{' '}
            <strong className="font-mono-num text-amber-700 dark:text-amber-400">
              {formatMoney(nonEssentialDueSoon, currency, 2)}
            </strong>
          </span>
          {cancelableDueSoon > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-red-700 dark:text-red-400 font-medium font-mono-num">
                {formatMoney(cancelableDueSoon, currency, 2)} marked to cancel before renewal
              </span>
            </>
          )}
        </div>
      )}

      {/* Bill Rows or Quiet-Week State */}
      {dueSoon.length === 0 ? (
        <div className="py-3 text-xs text-slate-600 dark:text-slate-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <p>
            No recurring bills are predicted within the next {windowDays} days.
            {nextAfterWindow && (
              <>
                {' '}
                Next expected:{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {nextAfterWindow.merchant}
                </strong>{' '}
                on{' '}
                <span className="font-mono-num">
                  {formatShortDueDate(nextAfterWindow.dueDate)}
                </span>{' '}
                (in {nextAfterWindow.daysUntilDue} days ·{' '}
                <span className="font-mono-num">
                  {formatMoney(nextAfterWindow.expectedAmount, currency, 2)}
                </span>
                ).
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {dueSoon.map((bill) => {
            const isUrgent = bill.daysUntilDue <= 2;
            const isForeign = bill.nativeCurrency !== currency;
            return (
              <div
                key={bill.id}
                className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {bill.merchant}
                    </p>
                    <span
                      className={`text-xs font-medium font-mono-num ${
                        isUrgent
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-teal-700 dark:text-teal-400'
                      }`}
                    >
                      {formatCountdown(bill.daysUntilDue)}
                    </span>
                    {bill.markedForCancel && (
                      <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                        · Cancel before renewal
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {formatShortDueDate(bill.dueDate)} · {bill.categoryLabel} ·{' '}
                    {bill.spendingClass === 'essential' ? 'Essential' : 'Non-Essential'} ·{' '}
                    {bill.cadence} ({bill.occurrences} prior charges)
                  </p>
                </div>

                <div className="sm:text-right font-mono-num shrink-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatMoney(bill.expectedAmount, currency, 2)}
                  </p>
                  {isForeign && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatMoney(bill.nativeAmount, bill.nativeCurrency, 2)} native
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: Next bill after 7-day window + Navigation Actions */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="text-slate-500 dark:text-slate-400">
          {dueSoon.length > 0 && nextAfterWindow ? (
            <>
              Next after {windowDays} days:{' '}
              <strong className="text-slate-700 dark:text-slate-300">
                {nextAfterWindow.merchant}
              </strong>{' '}
              on{' '}
              <span className="font-mono-num">
                {formatShortDueDate(nextAfterWindow.dueDate)}
              </span>{' '}
              (
              <span className="font-mono-num">
                {formatMoney(nextAfterWindow.expectedAmount, currency, 2)}
              </span>
              )
            </>
          ) : (
            'Detected 100% locally from recurring payment cadence'
          )}
        </span>

        <div className="flex items-center gap-4 shrink-0">
          <button
            type="button"
            onClick={onInspectLedger}
            className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap cursor-pointer"
          >
            View Ledger
          </button>
          <button
            type="button"
            onClick={onManageSubscriptions}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap cursor-pointer"
          >
            <span>Audit Subscriptions</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
};
