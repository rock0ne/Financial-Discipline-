import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RecurringItem } from '../src/types/finance';
import { computeSubscriptionAnnualProjection } from '../src/utils/analyticsEngine';

const SAMPLE_RECURRING: RecurringItem[] = [
  {
    id: 'rec-energy',
    merchant: 'Octopus Energy',
    categoryId: 'utilities',
    categoryLabel: 'Utilities & Energy',
    spendingClass: 'essential',
    subscriptionClass: 'essential',
    monthlyCost: 112.45,
    annualCost: 1349.4,
    occurrences: 6,
    lastDate: '2026-11-15',
    cadence: 'Monthly',
    priceIncreasePct: 8,
    action: 'keep',
    potentialMonthlySaving: 0,
  },
  {
    id: 'rec-netflix',
    merchant: 'Netflix',
    categoryId: 'subscriptions',
    categoryLabel: 'Subscriptions & Memberships',
    spendingClass: 'non-essential',
    subscriptionClass: 'cancelable',
    monthlyCost: 17.99,
    annualCost: 215.88,
    occurrences: 6,
    lastDate: '2026-11-18',
    cadence: 'Monthly',
    priceIncreasePct: 12,
    action: 'cancel',
    potentialMonthlySaving: 17.99,
  },
  {
    id: 'rec-water',
    merchant: 'Thames Water',
    categoryId: 'utilities',
    categoryLabel: 'Utilities & Energy',
    spendingClass: 'essential',
    subscriptionClass: 'essential',
    monthlyCost: 40,
    annualCost: 480,
    occurrences: 4,
    lastDate: '2026-11-01',
    cadence: 'Quarterly',
    action: 'keep',
    potentialMonthlySaving: 0,
  },
];

describe('computeSubscriptionAnnualProjection', () => {
  it('projects 12 forward months with exact pence precision, cadence timing, and Essential vs. Cancelable splits', () => {
    const proj = computeSubscriptionAnnualProjection(SAMPLE_RECURRING, '2026-11-20');

    assert.equal(proj.months.length, 12);
    assert.equal(proj.months[0].monthKey, '2026-12');
    assert.equal(proj.months[11].monthKey, '2027-11');
    assert.equal(proj.horizonLabel, 'Dec 26 – Nov 27');

    // Essential = (112.45 * 12) + (40 * 3 * 4) = 1349.40 + 480.00 = 1829.40
    assert.equal(proj.essentialAnnual, 1829.4);
    // Cancelable = 17.99 * 12 = 215.88
    assert.equal(proj.cancelableAnnual, 215.88);
    assert.equal(proj.totalAnnualBaseline, 2045.28);
    assert.equal(proj.optimizedAnnual, 1829.4);

    // Quarterly charge should land on months 3, 6, 9, 12 (not month 1)
    assert.equal(proj.months[0].essential, 112.45);
    assert.equal(proj.months[2].essential, 232.45);
    assert.equal(proj.months[11].cumulativeBaseline, 2045.28);
    assert.equal(proj.months[11].cumulativeOptimized, 1829.4);

    // Price hike drift across 2 hiked items (8% on 1349.40 + 12% on 215.88 = 107.952 + 25.9056 = 133.86)
    assert.equal(proj.hikedCount, 2);
    assert.equal(proj.priceHikeDriftAnnual, 133.86);
    assert.equal(proj.projectedWithDriftAnnual, 2179.14);

    // Top category breakdown
    assert.equal(proj.topCategories[0].categoryId, 'utilities');
    assert.equal(proj.topCategories[0].annualCost, 1829.4);
    assert.equal(proj.topCategories[1].categoryId, 'subscriptions');
    assert.equal(proj.topCategories[1].annualCost, 215.88);
  });

  it('handles an empty recurring list cleanly without NaN values', () => {
    const proj = computeSubscriptionAnnualProjection([], '2026-11-20');
    assert.equal(proj.itemCount, 0);
    assert.equal(proj.totalAnnualBaseline, 0);
    assert.equal(proj.essentialAnnual, 0);
    assert.equal(proj.cancelableAnnual, 0);
    assert.equal(proj.months.length, 12);
    assert.equal(proj.months[11].cumulativeBaseline, 0);
    assert.deepEqual(proj.topCategories, []);
  });
});
