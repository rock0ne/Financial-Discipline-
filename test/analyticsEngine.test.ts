import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProjectedCapAlerts,
  isMonthComplete,
  runLocalFinancialAnalytics,
} from '../src/utils/analyticsEngine';
import type { CategoryId, Transaction } from '../src/types/finance';

let seq = 0;

function createTx(
  date: string,
  category: CategoryId,
  amount: number,
  overrides: Partial<Transaction> = {}
): Transaction {
  seq += 1;
  const spendingClass: Transaction['spendingClass'] =
    category === 'salary_income' || category === 'other_income'
      ? 'income'
      : category === 'savings_investment'
        ? 'savings'
        : category === 'housing' ||
            category === 'utilities' ||
            category === 'groceries' ||
            category === 'transport' ||
            category === 'insurance_health'
          ? 'essential'
          : 'non-essential';

  return {
    id: `test_tx_${seq}`,
    date,
    description: `${category} entry`,
    merchant: `Test ${category}`,
    amount,
    currency: 'GBP',
    category,
    spendingClass,
    accountName: 'Current Account',
    ...overrides,
  };
}

describe('runLocalFinancialAnalytics', () => {
  describe('Empty ledger states', () => {
    it('returns clean zeroed totals and empty collections with no NaNs when ledger is empty', () => {
      const result = runLocalFinancialAnalytics([], {}, {}, 'all', {}, {}, 'GBP');

      assert.equal(result.monthCount, 0);
      assert.equal(result.dateRangeLabel, 'No statements loaded');
      assert.deepEqual(result.monthlySeries, []);
      assert.equal(result.totalIncome, 0);
      assert.equal(result.totalSpending, 0);
      assert.equal(result.avgMonthlyIncome, 0);
      assert.equal(result.avgMonthlySpending, 0);
      assert.equal(result.avgMonthlySurplus, 0);
      assert.equal(result.savingsRatePct, 0);
      assert.deepEqual(result.categoryDrains, []);
      assert.deepEqual(result.categoryCapStatuses, []);
      assert.deepEqual(result.merchantDrains, []);
      assert.deepEqual(result.recurringItems, []);
      assert.deepEqual(result.recommendations, []);
      assert.equal(result.spendingTrendProjection.monthsAnalyzed, 0);
      assert.equal(result.spendingTrendProjection.categories.length, 0);
      assert.equal(Number.isNaN(result.spendingTrendProjection.totalProjectedNextMonth), false);
    });

    it('marks capped categories as insufficient_data (never on_track or NaN) on an empty ledger', () => {
      const result = runLocalFinancialAnalytics(
        [],
        {},
        {},
        'all',
        {},
        { coffee_convenience: 60, dining_takeaway: 200 },
        'GBP'
      );

      const proj = result.spendingTrendProjection;
      assert.equal(proj.monthsAnalyzed, 0);
      assert.equal(proj.projectedOverLimitCount, 0);
      assert.equal(proj.varianceRiskCount, 0);
      assert.equal(proj.categories.length, 2);

      for (const cat of proj.categories) {
        assert.equal(cat.monthsObserved, 0);
        assert.equal(cat.riskStatus, 'insufficient_data');
        assert.equal(cat.projectedVsLimitDelta, null);
        assert.equal(Number.isNaN(cat.historicalMean), false);
        assert.equal(Number.isNaN(cat.projectedNextMonth), false);
        assert.equal(Number.isNaN(cat.stdDev), false);
      }
    });
  });

  describe('Partial trailing months', () => {
    it('excludes an in-progress trailing month from the forecast baseline by default so warnings are not reversed', () => {
      // Two complete months at £120 dining vs £100 cap, plus £6 on day 2 of November
      const txs: Transaction[] = [
        createTx('2026-09-01', 'salary_income', 3000),
        createTx('2026-09-28', 'dining_takeaway', -120),
        createTx('2026-10-01', 'salary_income', 3000),
        createTx('2026-10-29', 'dining_takeaway', -120),
        createTx('2026-11-01', 'salary_income', 3000),
        createTx('2026-11-02', 'dining_takeaway', -6),
      ];

      const result = runLocalFinancialAnalytics(
        txs,
        {},
        {},
        'all',
        {},
        { dining_takeaway: 100 },
        'GBP',
        undefined,
        { referenceDate: new Date(2026, 10, 2) } // 2 Nov 2026 -> 2026-11 is partial
      );

      // Monthly series retains all 3 calendar months for visual continuity,
      // while baseline averages exclude incomplete Nov 2026 so spend isn't diluted low
      assert.equal(result.monthCount, 3);
      assert.equal(result.baselineMonthCount, 2);
      assert.equal(result.excludedPartialMonth, '2026-11');
      assert.equal(result.monthlySeries.length, 3);
      assert.equal(result.avgMonthlySpending, 120);

      const capStatus = result.categoryCapStatuses.find(
        (c) => c.categoryId === 'dining_takeaway'
      );
      assert.ok(capStatus);
      assert.equal(capStatus.monthsObserved, 2);
      assert.equal(capStatus.monthlyAverage, 120);
      assert.equal(capStatus.variance, 20);
      assert.equal(capStatus.status, 'over');

      // Trend projection excludes partial Nov 2026 by default so £120 > £100 warning stays accurate
      const proj = result.spendingTrendProjection;
      assert.equal(proj.partialMonthMode, 'excluded');
      assert.equal(proj.excludedPartialMonth, '2026-11');
      assert.equal(proj.monthsAnalyzed, 2);

      const dining = proj.categories.find((c) => c.categoryId === 'dining_takeaway');
      assert.ok(dining);
      assert.equal(dining.monthsObserved, 2);
      assert.equal(dining.historicalMean, 120);
      assert.equal(dining.projectedNextMonth, 120);
      assert.equal(dining.projectedVsLimitDelta, 20);
      assert.equal(dining.partialMonthActual, 6);
      assert.equal(dining.riskStatus, 'projected_over');
    });

    it('detects and excludes a historical mid-month statement cutoff compared against prior coverage', () => {
      const txs: Transaction[] = [
        createTx('2026-01-29', 'groceries', -400),
        createTx('2026-02-27', 'groceries', -400),
        createTx('2026-03-30', 'groceries', -400),
        createTx('2026-04-28', 'groceries', -400),
        createTx('2026-05-08', 'groceries', -90), // Mid-month export cutoff
      ];

      const completeness = isMonthComplete('2026-05', 8, [29, 27, 30, 28], new Date(2026, 7, 15));
      assert.equal(completeness.complete, false);
      assert.equal(completeness.reason, 'mid_month_cutoff');

      const result = runLocalFinancialAnalytics(
        txs,
        {},
        {},
        'all',
        {},
        { groceries: 350 },
        'GBP',
        undefined,
        { referenceDate: new Date(2026, 7, 15) }
      );

      const proj = result.spendingTrendProjection;
      assert.equal(proj.partialMonthMode, 'excluded');
      assert.equal(proj.excludedPartialMonth, '2026-05');
      assert.equal(proj.monthsAnalyzed, 4);

      const groceries = proj.categories.find((c) => c.categoryId === 'groceries');
      assert.ok(groceries);
      assert.equal(groceries.projectedNextMonth, 400);
      assert.equal(groceries.riskStatus, 'projected_over');
    });

    it('pro-rates the partial trailing month only when the user explicitly opts in', () => {
      // Two complete months at £120 + half of November (15/30d) at £90 -> pro-rated £180
      const txs: Transaction[] = [
        createTx('2026-09-28', 'dining_takeaway', -120),
        createTx('2026-10-29', 'dining_takeaway', -120),
        createTx('2026-11-15', 'dining_takeaway', -90),
      ];

      const optedIn = runLocalFinancialAnalytics(
        txs,
        {},
        {},
        'all',
        {},
        { dining_takeaway: 140 },
        'GBP',
        undefined,
        { referenceDate: new Date(2026, 10, 15), proRatePartialMonth: true }
      );

      const proj = optedIn.spendingTrendProjection;
      assert.equal(proj.partialMonthMode, 'prorated');
      assert.equal(proj.excludedPartialMonth, null);
      assert.equal(proj.monthsAnalyzed, 3);

      const dining = proj.categories.find((c) => c.categoryId === 'dining_takeaway');
      assert.ok(dining);
      assert.equal(dining.monthsObserved, 3);
      assert.equal(dining.historicalMean, 140);
      assert.equal(dining.partialMonthActual, 90);
      assert.equal(dining.partialMonthProRated, 180);
      assert.ok(dining.projectedNextMonth > 140);
      assert.equal(dining.riskStatus, 'projected_over');
    });
  });

  describe('Short-history categories & structural zeros', () => {
    it('ignores leading structural zeros before a category first appears while preserving mid-history zero months', () => {
      const months = [
        '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
        '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
        '2026-07', '2026-08',
      ];
      const txs: Transaction[] = [];

      months.forEach((mk, idx) => {
        txs.push(createTx(`${mk}-01`, 'salary_income', 4000));
        txs.push(createTx(`${mk}-28`, 'housing', -1200));

        // Groceries active from month 1 with one genuine £0 month at index 5
        if (idx !== 5) {
          txs.push(createTx(`${mk}-20`, 'groceries', -300));
        }

        // Travel only starts in the final 3 months at £250/mo
        if (idx >= 11) {
          txs.push(createTx(`${mk}-22`, 'travel_holidays', -250));
        }
      });

      const result = runLocalFinancialAnalytics(
        txs,
        {},
        {},
        'all',
        {},
        { travel_holidays: 220, groceries: 350, entertainment_leisure: 100 },
        'GBP',
        undefined,
        { referenceDate: new Date(2026, 9, 1) } // All 14 months complete
      );

      const proj = result.spendingTrendProjection;
      assert.equal(proj.monthsAnalyzed, 14);

      const travelDrain = result.categoryDrains.find((c) => c.categoryId === 'travel_holidays');
      assert.ok(travelDrain);
      assert.equal(travelDrain.monthsObserved, 3);
      assert.equal(travelDrain.monthlyAverage, 250);

      const travelCap = result.categoryCapStatuses.find((c) => c.categoryId === 'travel_holidays');
      assert.ok(travelCap);
      assert.equal(travelCap.monthsObserved, 3);
      assert.equal(travelCap.monthlyAverage, 250);
      assert.equal(travelCap.status, 'over');

      const travel = proj.categories.find((c) => c.categoryId === 'travel_holidays');
      assert.ok(travel);
      assert.equal(travel.monthsObserved, 3);
      assert.equal(travel.historicalMean, 250);
      assert.equal(travel.stdDev, 0);
      assert.equal(travel.projectedNextMonth, 250);
      assert.equal(travel.riskStatus, 'projected_over');

      const groceries = proj.categories.find((c) => c.categoryId === 'groceries');
      assert.ok(groceries);
      assert.equal(groceries.monthsObserved, 14);
      assert.equal(groceries.historicalMean, Math.round(((13 * 300) / 14) * 100) / 100);

      // Capped category with zero transactions across the entire dataset -> insufficient_data
      const entertainment = proj.categories.find((c) => c.categoryId === 'entertainment_leisure');
      assert.ok(entertainment);
      assert.equal(entertainment.monthsObserved, 0);
      assert.equal(entertainment.riskStatus, 'insufficient_data');
    });
  });

  describe('Forecast accuracy, pence precision, and timeframe slicing', () => {
    it('retains pence precision so £60.40 vs £60 cap never produces contradictory £0 over warnings', () => {
      const txs: Transaction[] = [
        createTx('2026-01-28', 'coffee_convenience', -60.4),
        createTx('2026-02-28', 'coffee_convenience', -60.4),
        createTx('2026-03-28', 'coffee_convenience', -60.4),
      ];

      const result = runLocalFinancialAnalytics(
        txs,
        {},
        {},
        'all',
        {},
        { coffee_convenience: 60 },
        'GBP',
        undefined,
        { referenceDate: new Date(2026, 5, 1) }
      );

      const coffee = result.spendingTrendProjection.categories.find(
        (c) => c.categoryId === 'coffee_convenience'
      );
      assert.ok(coffee);
      assert.equal(coffee.projectedNextMonth, 60.4);
      assert.equal(coffee.projectedVsLimitDelta, 0.4);
      assert.equal(coffee.riskStatus, 'projected_over');
    });

    it('uses actual elapsed calendar months for trend slope when intermediate months are missing', () => {
      const txs: Transaction[] = [
        createTx('2026-01-28', 'shopping_retail', -100),
        createTx('2026-04-28', 'shopping_retail', -160),
      ];

      const result = runLocalFinancialAnalytics(
        txs,
        {},
        {},
        'all',
        {},
        { shopping_retail: 200 },
        'GBP',
        undefined,
        { referenceDate: new Date(2026, 6, 1) }
      );

      const retail = result.spendingTrendProjection.categories.find(
        (c) => c.categoryId === 'shopping_retail'
      );
      assert.ok(retail);
      assert.equal(retail.trendSlopePerMonth, 20); // +£60 / 3 calendar months
    });

    it('scopes both analytics totals and spendingTrendProjection consistently to timeframeMonths', () => {
      const months = [
        '2025-11', '2025-12', '2026-01', '2026-02',
        '2026-03', '2026-04', '2026-05', '2026-06',
      ];
      // First 2 months at £600/mo, last 6 months at £200/mo
      const txs: Transaction[] = months.map((mk, idx) =>
        createTx(`${mk}-28`, 'dining_takeaway', idx < 2 ? -600 : -200)
      );

      const sixMonth = runLocalFinancialAnalytics(
        txs,
        {},
        {},
        6,
        {},
        { dining_takeaway: 250 },
        'GBP',
        undefined,
        { referenceDate: new Date(2026, 8, 1) }
      );

      assert.equal(sixMonth.monthCount, 6);
      assert.equal(sixMonth.avgMonthlySpending, 200);
      assert.equal(sixMonth.spendingTrendProjection.monthsAnalyzed, 6);

      const dining = sixMonth.spendingTrendProjection.categories.find(
        (c) => c.categoryId === 'dining_takeaway'
      );
      assert.ok(dining);
      assert.equal(dining.historicalMean, 200);
      assert.equal(dining.projectedNextMonth, 200);
      assert.equal(dining.riskStatus, 'on_track');
    });

    it('preserves pence precision in computeProjectedCapAlerts so small overages never round to £0', () => {
      // 15 of 30 days elapsed with £30.20 spent -> projected £60.40 vs £60 cap (+£0.40)
      const txs: Transaction[] = [createTx('2026-11-15', 'coffee_convenience', -30.2)];
      const alerts = computeProjectedCapAlerts(
        txs,
        { coffee_convenience: 60 },
        new Date(2026, 10, 15),
        'GBP'
      );

      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].spentToDate, 30.2);
      assert.equal(alerts[0].projectedMonthEnd, 60.4);
      assert.equal(alerts[0].projectedOverage, 0.4);
    });
  });
});
