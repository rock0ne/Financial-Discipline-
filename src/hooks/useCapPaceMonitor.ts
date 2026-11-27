import { useEffect, useMemo, useState } from 'react';
import type {
  CapPaceAlert,
  CategoryId,
  CurrencyCode,
  ExchangeRateTable,
  Transaction,
} from '../types/finance';
import { computeProjectedCapAlerts } from '../utils/analyticsEngine';

interface CapPaceMonitorResult {
  alerts: CapPaceAlert[];
  visibleAlerts: CapPaceAlert[];
  dismissed: boolean;
  dismiss: () => void;
  lastCheckedAt: string | null;
}

/**
 * Local-only background spending-cap monitor.
 * Runs asynchronously during browser idle time and on a local 60-second heartbeat
 * to project whether any category will exceed its custom monthly cap before month-end.
 */
export function useCapPaceMonitor(
  transactions: Transaction[],
  categoryCaps: Partial<Record<CategoryId, number>> | undefined,
  displayCurrency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>
): CapPaceMonitorResult {
  const [alerts, setAlerts] = useState<CapPaceAlert[]>([]);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);

  // Build deterministic signature so dismissing stays dismissed until caps or projected overages change
  const alertSignature = useMemo(
    () =>
      alerts
        .map((a) => `${a.categoryId}:${a.monthlyCap}:${a.projectedMonthEnd}`)
        .join('|'),
    [alerts]
  );

  useEffect(() => {
    let cancelled = false;

    const runBackgroundCheck = () => {
      const compute = () => {
        if (cancelled) return;
        const found = computeProjectedCapAlerts(
          transactions,
          categoryCaps ?? {},
          new Date(),
          displayCurrency,
          exchangeRates
        );
        setAlerts(found);
        setLastCheckedAt(new Date().toISOString());
      };

      // Schedule non-blocking background execution via requestIdleCallback when available
      const win = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };

      if (typeof win.requestIdleCallback === 'function') {
        const idleId = win.requestIdleCallback(compute, { timeout: 600 });
        return () => win.cancelIdleCallback?.(idleId);
      }
      const timeoutId = window.setTimeout(compute, 40);
      return () => window.clearTimeout(timeoutId);
    };

    let cancelScheduled = runBackgroundCheck();

    // Periodic local background re-check every 60 seconds (zero network calls)
    const intervalId = window.setInterval(() => {
      cancelScheduled?.();
      cancelScheduled = runBackgroundCheck();
    }, 60_000);

    return () => {
      cancelled = true;
      cancelScheduled?.();
      window.clearInterval(intervalId);
    };
  }, [transactions, categoryCaps, displayCurrency, exchangeRates]);

  const dismissed = Boolean(alertSignature && dismissedSignature === alertSignature);

  return {
    alerts,
    visibleAlerts: dismissed ? [] : alerts,
    dismissed,
    dismiss: () => setDismissedSignature(alertSignature),
    lastCheckedAt,
  };
}
