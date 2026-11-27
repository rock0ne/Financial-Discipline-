import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCategoryVarianceProjections,
  isMonthComplete,
} from '../analyticsEngine';
import type { CategoryId, Transaction } from '../../types/finance';

let txSeq = 0;

function makeTx(
  date: string,
  category: CategoryId,
  amount: number,
  overrides: Partial<Transaction> = {}
): Transaction {
  txSeq += 1;
  return {
    id: `tx_${txSeq}`,
    date,
    description: `${category} purchase`,
    merchant: `Merchant ${category}`,
    amount,
    currency: 'GBP',
    category,
    spendingClass:
      category === 'salary_income' || category === 'other_income'
        ? 'income'
        : category === 'savings_investment'
          ? 'savings'
          : category === 'groceries' ||
              category === 'housing' ||
              category === 'utilities' ||
              category === 'transport' ||
              category === 'insurance_health'
            ? 'essential'
            : 'non-essential',
    accountName: 'Main Current',
    ...overrides,
  };
}

describe('computeCategoryVarianceProjections', () => {
  it('returns insufficient_data (never NaN or on_track) on an empty ledger with caps', () => {
    const summary = computeCategoryVarianceProjections([], { coffee_convenience: 60 }, 'GBP');

    assert.equal(summary.monthsAnalyzed, 0);
    assert.equal(Number.isNaN(summary.totalProjectedNextMonth), false);
    assert.equal(summary.categories.length, 1);

    const coffee = summary.categories[0];
    assert.equal(coffee.categoryId, 'coffee_convenience');
    assert.equal(coffee.monthsObserved, 0);
    assert.equal(Number.isNaN(coffee.historicalMean), false);
    assert.equal(Number.isNaN(coffee.projectedNextMonth), false);
    assert.equal(coffee.riskStatus, 'insufficient_data');
    assert.equal(coffee.projectedVsLimitDelta, null);
  });

  it('prevents a 2-day partial November (£6) from reversing a £120 vs £100 cap warning', () => {
    // Astra exact repro: two complete months at £120 against a £100 cap + £6 on Nov 2
    const txs: Transaction[] = [
      makeTx('2026-09-28', 'dining_takeaway', -120),
      makeTx('2026-10-29', 'dining_takeaway', -120),
      makeTx('2026-11-02', 'dining_takeaway', -6),
    ];

    const summary = computeCategoryVarianceProjections(
      txs,
      { dining_takeaway: 100 },
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 10, 26) }
    );

    assert.equal(summary.excludedPartialMonth, '2026-11');
    assert.equal(summary.monthsAnalyzed, 2);

    const dining = summary.categories.find((c) => c.categoryId === 'dining_takeaway');
    assert.ok(dining);
    assert.equal(dining.projectedNextMonth, 120);
    assert.equal(dining.projectedVsLimitDelta, 20);
    assert.equal(dining.partialMonthActual, 6);
    assert.equal(dining.riskStatus, 'projected_over');
  });

  it('excludes a historical mid-month statement cutoff when prior months cover month-end', () => {
    const txs: Transaction[] = [
      makeTx('2026-01-29', 'dining_takeaway', -300),
      makeTx('2026-02-27', 'dining_takeaway', -300),
      makeTx('2026-03-30', 'dining_takeaway', -300),
      makeTx('2026-04-28', 'dining_takeaway', -300),
      makeTx('2026-05-10', 'dining_takeaway', -80),
    ];

    const summary = computeCategoryVarianceProjections(
      txs,
      { dining_takeaway: 250 },
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 7, 15) }
    );

    assert.equal(summary.excludedPartialMonth, '2026-05');
    assert.equal(summary.monthsAnalyzed, 4);

    const dining = summary.categories.find((c) => c.categoryId === 'dining_takeaway');
    assert.ok(dining);
    assert.equal(dining.historicalMean, 300);
    assert.equal(dining.projectedNextMonth, 300);
    assert.equal(dining.partialMonthActual, 80);
    assert.equal(dining.riskStatus, 'projected_over');
  });

  it('does not falsely exclude complete historical months with consistent mid-month billing days', () => {
    const txs: Transaction[] = [
      makeTx('2026-01-15', 'subscriptions', -50),
      makeTx('2026-02-15', 'subscriptions', -50),
      makeTx('2026-03-15', 'subscriptions', -50),
      makeTx('2026-04-15', 'subscriptions', -50),
    ];

    const summary = computeCategoryVarianceProjections(
      txs,
      { subscriptions: 60 },
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 7, 1) }
    );

    assert.equal(summary.excludedPartialMonth, null);
    assert.equal(summary.monthsAnalyzed, 4);
    const subs = summary.categories.find((c) => c.categoryId === 'subscriptions');
    assert.ok(subs);
    assert.equal(subs.monthsObserved, 4);
    assert.equal(subs.projectedNextMonth, 50);
  });

  it('computes OLS slope over actual elapsed calendar months (Jan -> Apr = 3 months, not 1)', () => {
    const txs: Transaction[] = [
      makeTx('2026-01-28', 'shopping_retail', -100),
      makeTx('2026-04-28', 'shopping_retail', -160),
    ];

    const summary = computeCategoryVarianceProjections(
      txs,
      { shopping_retail: 200 },
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 6, 1) }
    );

    const retail = summary.categories.find((c) => c.categoryId === 'shopping_retail');
    assert.ok(retail);
    // +£60 over 3 elapsed calendar months = +£20/month (not +£60/slot)
    assert.equal(retail.trendSlopePerMonth, 20);
  });

  it('retains pence precision so £60.40 vs £60 cap never displays as £60 and £0 over', () => {
    const txs: Transaction[] = [
      makeTx('2026-01-28', 'coffee_convenience', -60.4),
      makeTx('2026-02-28', 'coffee_convenience', -60.4),
      makeTx('2026-03-28', 'coffee_convenience', -60.4),
    ];

    const summary = computeCategoryVarianceProjections(
      txs,
      { coffee_convenience: 60 },
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 5, 1) }
    );

    const coffee = summary.categories.find((c) => c.categoryId === 'coffee_convenience');
    assert.ok(coffee);
    assert.equal(coffee.projectedNextMonth, 60.4);
    assert.equal(coffee.projectedVsLimitDelta, 0.4);
    assert.equal(coffee.riskStatus, 'projected_over');
  });

  it('fits short-history categories from their first non-zero month without global-window dilution', () => {
    const months = [
      '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08',
    ];
    const txs: Transaction[] = [];

    months.forEach((mk, idx) => {
      txs.push(makeTx(`${mk}-28`, 'housing', -1200));
      if (idx !== 6) {
        txs.push(makeTx(`${mk}-20`, 'groceries', -300));
      }
      if (idx >= 11) {
        txs.push(makeTx(`${mk}-22`, 'dining_takeaway', -300));
      }
    });

    const summary = computeCategoryVarianceProjections(
      txs,
      { dining_takeaway: 280, groceries: 350 },
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 9, 1) }
    );

    assert.equal(summary.monthsAnalyzed, 14);

    const dining = summary.categories.find((c) => c.categoryId === 'dining_takeaway');
    assert.ok(dining);
    assert.equal(dining.monthsObserved, 3);
    assert.equal(dining.historicalMean, 300);
    assert.equal(dining.stdDev, 0);
    assert.equal(dining.projectedNextMonth, 300);
    assert.equal(dining.riskStatus, 'projected_over');

    const groceries = summary.categories.find((c) => c.categoryId === 'groceries');
    assert.ok(groceries);
    assert.equal(groceries.monthsObserved, 14);
    assert.equal(groceries.historicalMean, Math.round(((13 * 300) / 14) * 100) / 100);
  });

  it('produces zero slope, zero stdDev, and exact flat forecast on a constant series', () => {
    const txs: Transaction[] = [
      makeTx('2026-01-28', 'utilities', -250),
      makeTx('2026-02-28', 'utilities', -250),
      makeTx('2026-03-28', 'utilities', -250),
      makeTx('2026-04-28', 'utilities', -250),
      makeTx('2026-05-28', 'utilities', -250),
      makeTx('2026-06-28', 'utilities', -250),
    ];

    const summary = computeCategoryVarianceProjections(
      txs,
      { utilities: 250 },
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 8, 1) }
    );

    const util = summary.categories.find((c) => c.categoryId === 'utilities');
    assert.ok(util);
    assert.equal(util.trendSlopePerMonth, 0);
    assert.equal(util.stdDev, 0);
    assert.equal(util.historicalMean, 250);
    assert.equal(util.projectedNextMonth, 250);
    assert.equal(util.lowerBoundSpend, 250);
    assert.equal(util.upperBoundSpend, 250);
    assert.equal(util.riskStatus, 'on_track');
  });

  it('classifies and orders all five riskStatus boundaries accurately', () => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    const txs: Transaction[] = [];

    months.forEach((mk, idx) => {
      txs.push(makeTx(`${mk}-28`, 'dining_takeaway', -320));
      txs.push(makeTx(`${mk}-27`, 'shopping_retail', idx % 2 === 0 ? -180 : -320));
      txs.push(makeTx(`${mk}-26`, 'transport', -150));
      txs.push(makeTx(`${mk}-25`, 'coffee_convenience', -120));
    });

    const summary = computeCategoryVarianceProjections(
      txs,
      {
        dining_takeaway: 300,
        shopping_retail: 290,
        transport: 250,
        travel_holidays: 150, // capped with zero observed spending -> insufficient_data
      },
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 8, 1) }
    );

    const byId = Object.fromEntries(summary.categories.map((c) => [c.categoryId, c]));
    assert.equal(byId.dining_takeaway.riskStatus, 'projected_over');
    assert.equal(byId.shopping_retail.riskStatus, 'variance_risk');
    assert.equal(byId.transport.riskStatus, 'on_track');
    assert.equal(byId.travel_holidays.riskStatus, 'insufficient_data');
    assert.equal(byId.coffee_convenience.riskStatus, 'uncapped');

    assert.equal(summary.projectedOverLimitCount, 1);
    assert.equal(summary.varianceRiskCount, 1);
    assert.deepEqual(
      summary.categories.map((c) => c.riskStatus),
      ['projected_over', 'variance_risk', 'on_track', 'insufficient_data', 'uncapped']
    );
  });

  it('nets spending-category refunds and respects capsCurrency unit conversion', () => {
    const txs: Transaction[] = [
      makeTx('2026-01-28', 'groceries', -250),
      makeTx('2026-01-29', 'groceries', 50), // £50 refund -> net £200
      makeTx('2026-02-28', 'groceries', -200),
      makeTx('2026-03-28', 'groceries', -200),
    ];

    const summary = computeCategoryVarianceProjections(
      txs,
      { groceries: 220 },
      'EUR',
      { GBP: 1, EUR: 1.2 },
      {
        referenceDate: new Date(2026, 5, 1),
        capsCurrency: 'GBP',
        netRefunds: true,
      }
    );

    const groceries = summary.categories.find((c) => c.categoryId === 'groceries');
    assert.ok(groceries);
    assert.equal(groceries.historicalMean, 240);
    assert.equal(groceries.projectedNextMonth, 240);
    assert.equal(groceries.monthlyCap, 264);
    assert.equal(groceries.riskStatus, 'on_track');
  });

  it('evaluates isMonthComplete accurately for live, mid-month cutoff, and complete months', () => {
    const inProgress = isMonthComplete('2026-11', 20, [28, 30], new Date(2026, 10, 26));
    assert.equal(inProgress.complete, false);
    assert.equal(inProgress.reason, 'current_month_in_progress');
    assert.equal(inProgress.daysElapsed, 26);
    assert.equal(inProgress.daysInMonth, 30);

    const midCutoff = isMonthComplete('2026-05', 10, [28, 29, 30], new Date(2026, 7, 1));
    assert.equal(midCutoff.complete, false);
    assert.equal(midCutoff.reason, 'mid_month_cutoff');
    assert.equal(midCutoff.daysElapsed, 10);

    const complete = isMonthComplete('2026-10', 30, [28, 29, 30], new Date(2026, 10, 26));
    assert.equal(complete.complete, true);
    assert.equal(complete.reason, 'complete');
  });

  it('pro-rates the partial trailing month only when proRatePartialMonth is explicitly opted in', () => {
    // Sep & Oct complete at £120; Nov has £90 by day 15 of 30 -> pro-rated pace is £180
    const txs: Transaction[] = [
      makeTx('2026-09-28', 'dining_takeaway', -120),
      makeTx('2026-10-29', 'dining_takeaway', -120),
      makeTx('2026-11-15', 'dining_takeaway', -90),
    ];

    const excludedDefault = computeCategoryVarianceProjections(
      txs,
      { dining_takeaway: 140 },
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 10, 15) }
    );
    assert.equal(excludedDefault.partialMonthMode, 'excluded');
    assert.equal(excludedDefault.monthsAnalyzed, 2);
    const defaultDining = excludedDefault.categories.find((c) => c.categoryId === 'dining_takeaway');
    assert.ok(defaultDining);
    assert.equal(defaultDining.projectedNextMonth, 120);
    assert.equal(defaultDining.partialMonthActual, 90);
    assert.equal(defaultDining.partialMonthProRated, 180);

    const optedInProRated = computeCategoryVarianceProjections(
      txs,
      { dining_takeaway: 140 },
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 10, 15), proRatePartialMonth: true }
    );
    assert.equal(optedInProRated.partialMonthMode, 'prorated');
    assert.equal(optedInProRated.monthsAnalyzed, 3);
    assert.equal(optedInProRated.excludedPartialMonth, null);
    const proRatedDining = optedInProRated.categories.find((c) => c.categoryId === 'dining_takeaway');
    assert.ok(proRatedDining);
    assert.equal(proRatedDining.monthsObserved, 3);
    assert.equal(proRatedDining.historicalMean, 140); // (120 + 120 + 180) / 3
    assert.ok(
      proRatedDining.projectedNextMonth > 140,
      'pro-rated upward pace should push projection above £140 cap'
    );
    assert.equal(proRatedDining.riskStatus, 'projected_over');
  });
});
