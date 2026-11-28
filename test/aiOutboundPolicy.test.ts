import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAdvisorRequestJson,
  validateSanitizedPacket,
} from '../src/utils/aiOutboundPolicy';
import { runLocalFinancialAnalytics } from '../src/utils/analyticsEngine';
import { buildSanitizedAiPacket } from '../src/utils/privacySanitizer';
import { generateSample14MonthData } from '../src/utils/sampleData';
import type { SanitizedFinancialPacket } from '../src/utils/privacySanitizer';

const ratiosPacket: SanitizedFinancialPacket = {
  schemaVersion: 'clearledger-zero-pii-v1',
  privacyMode: 'ratios_and_bands_only',
  currency: 'GBP',
  monthsAnalyzed: 2,
  incomeBand: 'Under £2,000/mo',
  ratios: {
    essentialPctOfIncome: 40,
    nonEssentialPctOfIncome: 20,
    currentSavingsRatePct: 10,
    projectedSavingsRateWithCutsPct: 15,
  },
  recurringSignals: {
    recurringBillCount: 2,
    discretionarySubscriptionCount: 1,
    billsWithPriceHikeCount: 0,
    avgPriceHikePct: 0,
    flaggedToCancelOrNegotiateCount: 1,
  },
  categoryBreakdown: [{
    category: 'Housing & Council Tax',
    classification: 'essential',
    shareOfSpendingPct: 50,
    shareOfIncomePct: 40,
    recent3MonthTrendPct: 0,
  }],
  isaStrategy: {
    horizonYears: 5,
    taxBand: 'basic_20',
    cashIsaRatePct: 4,
    stocksIsaRatePct: 7,
    lisaRatePct: 3,
    splitPct: { cashIsa: 50, lifetimeIsa: 25, stocksIsa: 25 },
    isaAnnualCapUsagePct: 10,
  },
  goals: [{
    label: 'Goal 1 (cash isa)',
    vehicle: 'cash_isa',
    fundedPct: 25,
    monthlyAllocationPct: 20,
  }],
};

function copy(): Record<string, any> {
  return JSON.parse(JSON.stringify(ratiosPacket)) as Record<string, any>;
}

describe('AI outbound policy', () => {
  it('accepts actual sample-data packets in both privacy modes', () => {
    const sample = generateSample14MonthData();
    const analytics = runLocalFinancialAnalytics(
      sample.transactions,
      sample.recurringActions,
      sample.recommendationOverrides
    );
    for (const ratiosOnly of [true, false]) {
      const packet = buildSanitizedAiPacket(
        analytics,
        sample.isaSettings,
        sample.goals,
        'GBP',
        ratiosOnly
      );
      assert.equal(validateSanitizedPacket(packet).ok, true);
    }
  });

  it('accepts the locally generated ratios-only and rounded-amount shapes', () => {
    assert.equal(validateSanitizedPacket(ratiosPacket).ok, true);
    const aggregated = copy();
    aggregated.privacyMode = 'aggregated_amounts';
    aggregated.monthlyAveragesRounded = {
      netIncome: 1200,
      essentialSpend: 500,
      nonEssentialSpend: 250,
      currentSurplus: 450,
      identifiedMonthlyCuts: 50,
      totalPotentialMonthlySavings: 500,
    };
    aggregated.categoryBreakdown[0].monthlyAverageRounded = 400;
    aggregated.goals[0].targetAmountRounded = 1000;
    aggregated.isaStrategy.projectedFinalCashIsaRounded = 10000;
    aggregated.isaStrategy.projectedFinalBlendedIsaRounded = 12000;
    aggregated.isaStrategy.estimatedTaxAndBonusBenefitRounded = 2000;
    assert.equal(validateSanitizedPacket(aggregated).ok, true);
  });

  it('rejects unexpected data at every nested boundary', () => {
    const mutations: Array<(packet: Record<string, any>) => void> = [
      (p) => { p.rawCsv = 'synthetic-data'; },
      (p) => { p.ratios.rawCsv = 'synthetic-data'; },
      (p) => { p.recurringSignals.accountNumber = '12345678'; },
      (p) => { p.categoryBreakdown[0].rawTransaction = 'synthetic-data'; },
      (p) => { p.isaStrategy.splitPct.iban = 'synthetic-data'; },
      (p) => { p.goals[0].merchant = 'synthetic-data'; },
    ];
    for (const mutate of mutations) {
      const packet = copy();
      mutate(packet);
      assert.equal(validateSanitizedPacket(packet).ok, false);
    }
  });

  it('rejects arbitrary text in summary labels and masked-mode amount fields', () => {
    const arbitraryCategory = copy();
    arbitraryCategory.categoryBreakdown[0].category = 'Personal name or account label';
    assert.equal(validateSanitizedPacket(arbitraryCategory).ok, false);

    const arbitraryGoal = copy();
    arbitraryGoal.goals[0].label = 'My private savings goal';
    assert.equal(validateSanitizedPacket(arbitraryGoal).ok, false);

    const maskedWithAmount = copy();
    maskedWithAmount.monthlyAveragesRounded = { netIncome: 1000 };
    assert.equal(validateSanitizedPacket(maskedWithAmount).ok, false);
  });

  it('includes the complete optional question in the exact proxy request JSON', () => {
    const json = buildAdvisorRequestJson('gemini', ratiosPacket, '  Should I save more?  ');
    const request = JSON.parse(json);
    assert.equal(request.provider, 'gemini');
    assert.deepEqual(request.summary, ratiosPacket);
    assert.equal(request.question, 'Should I save more?');
  });
});
