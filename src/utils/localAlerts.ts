import {
  CATEGORIES,
  CURRENCY_CONFIG,
  convertAmount,
  formatMoney,
  getTransactionDisplayAmount,
  type CategoryId,
  type CurrencyCode,
  type ExchangeRateTable,
  type LocalAlertRule,
  type Transaction,
} from '../types/finance';
import { computeProjectedCapAlerts } from './analyticsEngine';

export interface LocalAlertMatch {
  ruleId: string;
  kind: LocalAlertRule['kind'];
  /** Stable within the period, for one notification per rule and period. */
  receiptKey: string;
  title: string;
  detail: string;
}

const MAX_RULES = 32;
const RULE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATEGORIES, value);
}

function isSpendingCategory(value: unknown): value is CategoryId {
  return isCategoryId(value) &&
    CATEGORIES[value].defaultClass !== 'income' &&
    CATEGORIES[value].defaultClass !== 'savings';
}

function validLocalDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_DATETIME.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}` === value;
}

/** Imported vault data is untrusted; ignore malformed or excessive alert rules. */
export function normalizeLocalAlertRules(input: unknown): LocalAlertRule[] {
  if (!Array.isArray(input)) return [];
  const result: LocalAlertRule[] = [];
  const seen = new Set<string>();
  for (const item of input.slice(0, MAX_RULES)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rule = item as Record<string, unknown>;
    if (typeof rule.id !== 'string' || !RULE_ID.test(rule.id) || seen.has(rule.id) ||
        typeof rule.enabled !== 'boolean' || typeof rule.createdAt !== 'string' ||
        rule.createdAt.length > 40) continue;
    if (rule.kind === 'category_spend' && isSpendingCategory(rule.categoryId) &&
        typeof rule.thresholdCurrency === 'string' &&
        Object.prototype.hasOwnProperty.call(CURRENCY_CONFIG, rule.thresholdCurrency) &&
        typeof rule.threshold === 'number' && Number.isFinite(rule.threshold) &&
        rule.threshold > 0 && rule.threshold <= 1_000_000_000) {
      result.push({ id: rule.id, kind: rule.kind, enabled: rule.enabled,
        categoryId: rule.categoryId, threshold: rule.threshold,
        thresholdCurrency: rule.thresholdCurrency as CurrencyCode, createdAt: rule.createdAt });
    } else if (rule.kind === 'projected_cap' && isSpendingCategory(rule.categoryId)) {
      result.push({ id: rule.id, kind: rule.kind, enabled: rule.enabled,
        categoryId: rule.categoryId, createdAt: rule.createdAt });
    } else if (rule.kind === 'date_reminder' && validLocalDateTime(rule.at)) {
      result.push({ id: rule.id, kind: rule.kind, enabled: rule.enabled,
        at: rule.at,
        ...(typeof rule.label === 'string' && rule.label.trim().length > 0 && rule.label.trim().length <= 80
          ? { label: rule.label.trim() } : {}),
        createdAt: rule.createdAt });
    } else {
      continue;
    }
    seen.add(rule.id);
  }
  return result;
}

export function evaluateLocalAlerts(
  rawRules: unknown,
  transactions: Transaction[],
  categoryCaps: Partial<Record<CategoryId, number>>,
  currency: CurrencyCode,
  exchangeRates: Partial<ExchangeRateTable> | undefined,
  now: Date = new Date()
): LocalAlertMatch[] {
  const rules = normalizeLocalAlertRules(rawRules).filter((rule) => rule.enabled);
  if (rules.length === 0) return [];
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const todayKey = `${monthKey}-${String(now.getDate()).padStart(2, '0')}`;
  const capAlerts = computeProjectedCapAlerts(
    transactions, categoryCaps, now, currency, exchangeRates
  ).filter((alert) => alert.monthKey === monthKey);
  const spending = new Map<CategoryId, number>();
  for (const tx of transactions) {
    if (!tx.date.startsWith(monthKey) || tx.date > todayKey ||
        tx.spendingClass === 'income' || tx.spendingClass === 'savings') continue;
    // Positive same-category rows are refunds under the ledger sign convention.
    // Net them against spending, without treating unrelated income as a refund.
    const amount = -getTransactionDisplayAmount(tx, currency, exchangeRates);
    if (!Number.isFinite(amount)) continue;
    spending.set(tx.category, (spending.get(tx.category) ?? 0) + amount);
  }

  const matches: LocalAlertMatch[] = [];
  for (const rule of rules) {
    if (rule.kind === 'category_spend') {
      const amount = Math.max(0, spending.get(rule.categoryId) ?? 0);
      const threshold = convertAmount(rule.threshold, rule.thresholdCurrency, currency, exchangeRates);
      if (amount >= threshold) matches.push({
        ruleId: rule.id, kind: rule.kind, receiptKey: `${rule.id}:${monthKey}`,
        title: `${CATEGORIES[rule.categoryId].label} threshold reached`,
        detail: `${formatMoney(amount, currency, 2)} recorded this month against your ${formatMoney(threshold, currency, 2)} trigger (set as ${formatMoney(rule.threshold, rule.thresholdCurrency, 2)}). This uses imported statements only.`,
      });
    } else if (rule.kind === 'projected_cap') {
      const match = capAlerts.find((alert) => alert.categoryId === rule.categoryId);
      if (match) matches.push({
        ruleId: rule.id, kind: rule.kind, receiptKey: `${rule.id}:${monthKey}`,
        title: `${CATEGORIES[rule.categoryId].label} cap pace alert`,
        detail: `Current imported data projects ${formatMoney(match.projectedMonthEnd, currency, 2)} against your ${formatMoney(match.monthlyCap, currency, 2)} cap.`,
      });
    } else {
      const due = new Date(rule.at).getTime();
      if (due <= now.getTime() && now.getTime() - due <= 24 * 60 * 60 * 1000) {
        matches.push({
          ruleId: rule.id, kind: rule.kind, receiptKey: `${rule.id}:${rule.at}`,
          title: rule.label ? `${rule.label} is due` : 'Your Clearledger reminder is due',
          detail: 'Open your local plan to review it. No statement is read in the background.',
        });
      }
    }
  }
  return matches;
}

/** A stable positive 31-bit Android notification identifier, namespaced by rule and kind. */
export function notificationId(ruleId: string, purpose: 'trigger' | 'reminder'): number {
  let hash = 2166136261;
  for (const char of `clearledger:${purpose}:${ruleId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 1) || 1;
}
