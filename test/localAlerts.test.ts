import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LocalAlertRule, Transaction } from '../src/types/finance';
import {
  evaluateLocalAlerts,
  normalizeLocalAlertRules,
  notificationId,
} from '../src/utils/localAlerts';

const now = new Date(2026, 10, 28, 10, 0);
const expense = (id: string, date: string, amount: number, category: Transaction['category'] = 'groceries', currency: Transaction['currency'] = 'GBP'): Transaction => ({
  id, date, amount, category, currency, spendingClass: 'essential',
  description: 'Synthetic test', merchant: 'Synthetic', accountName: 'Synthetic',
});
const base = { enabled: true, createdAt: '2026-11-28T08:00:00Z' } as const;

describe('local alert rules', () => {
  it('normalizes untrusted vault rules and ignores unknown data', () => {
    const rules = normalizeLocalAlertRules([
      { ...base, id: 'valid', kind: 'category_spend', categoryId: 'groceries', threshold: 50, thresholdCurrency: 'GBP', secret: 'ignored' },
      { ...base, id: 'valid', kind: 'date_reminder', at: '2026-11-28T12:00' },
      { ...base, id: 'invalid', kind: 'category_spend', categoryId: 'groceries', threshold: Number.NaN, thresholdCurrency: 'GBP' },
      { ...base, id: 'bad-date', kind: 'date_reminder', at: '2026-02-30T09:00' },
    ]);
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0], { ...base, id: 'valid', kind: 'category_spend', categoryId: 'groceries', threshold: 50, thresholdCurrency: 'GBP' });
  });

  it('alerts once per current month threshold using net converted spending, not stale, future or income rows', () => {
    const rules: LocalAlertRule[] = [{ ...base, id: 'groceries', kind: 'category_spend', categoryId: 'groceries', threshold: 90, thresholdCurrency: 'GBP' }];
    const matches = evaluateLocalAlerts(rules, [
      expense('current', '2026-11-27', -127, 'groceries', 'USD'),
      expense('refund', '2026-11-27', 5, 'groceries', 'GBP'),
      expense('old', '2026-10-31', -1000),
      expense('future', '2026-11-30', -1000),
      { ...expense('income', '2026-11-27', 500), spendingClass: 'income' },
    ], {}, 'GBP', undefined, now);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].receiptKey, 'groceries:2026-11');
    assert.match(matches[0].detail, /imported statements only/);
    assert.equal(evaluateLocalAlerts(rules, [expense('old', '2026-10-28', -1000)], {}, 'GBP', undefined, now).length, 0);
    assert.equal(evaluateLocalAlerts(rules, [expense('charge', '2026-11-27', -110), expense('refund', '2026-11-27', 21)], {}, 'GBP', undefined, now).length, 0);
  });

  it('uses the current-month cap pace only and includes a time-bound reminder', () => {
    const rules: LocalAlertRule[] = [
      { ...base, id: 'cap', kind: 'projected_cap', categoryId: 'groceries' },
      { ...base, id: 'due', kind: 'date_reminder', at: '2026-11-28T09:00' },
      { ...base, id: 'not-yet', kind: 'date_reminder', at: '2026-11-29T09:00' },
      { ...base, id: 'too-old', kind: 'date_reminder', at: '2026-11-26T09:00' },
    ];
    const matches = evaluateLocalAlerts(rules, [expense('current', '2026-11-27', -100)], { groceries: 80 }, 'GBP', undefined, now);
    assert.deepEqual(matches.map((match) => match.ruleId), ['cap', 'due']);
    assert.equal(evaluateLocalAlerts(rules, [expense('old', '2026-10-27', -100)], { groceries: 80 }, 'GBP', undefined, now).some((match) => match.ruleId === 'cap'), false);
  });

  it('preserves a threshold’s original currency when the display currency changes', () => {
    const rules: LocalAlertRule[] = [{ ...base, id: 'fixed-gbp', kind: 'category_spend', categoryId: 'groceries', threshold: 100, thresholdCurrency: 'GBP' }];
    const rows = [expense('charge', '2026-11-27', -110, 'groceries', 'GBP')];
    const gbp = evaluateLocalAlerts(rules, rows, {}, 'GBP', undefined, now);
    const usd = evaluateLocalAlerts(rules, rows, {}, 'USD', undefined, now);
    assert.equal(gbp.length, 1);
    assert.equal(usd.length, 1);
    assert.match(usd[0].detail, /set as £100/);
    assert.equal(evaluateLocalAlerts(rules, [expense('under', '2026-11-27', -90, 'groceries', 'GBP')], {}, 'USD', undefined, now).length, 0);
  });

  it('generates stable positive platform notification IDs', () => {
    assert.equal(notificationId('rule-1', 'trigger'), notificationId('rule-1', 'trigger'));
    assert.notEqual(notificationId('rule-1', 'trigger'), notificationId('rule-1', 'reminder'));
    assert.ok(notificationId('rule-1', 'trigger') > 0);
  });
});
