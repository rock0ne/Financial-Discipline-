import type {
  CurrencyCode,
  IsaPlannerSettings,
  SavingsGoal,
} from '../types/finance';
import { computeWealthProjections, type AnalyticsResult } from './analyticsEngine';

export interface SanitizedCategoryMetric {
  category: string;
  classification: 'essential' | 'non-essential';
  shareOfSpendingPct: number;
  shareOfIncomePct: number;
  monthlyAverageRounded?: number;
  recent3MonthTrendPct: number;
}

export interface SanitizedGoalMetric {
  label: string;
  vehicle: string;
  fundedPct: number;
  targetAmountRounded?: number;
  monthlyAllocationPct: number;
}

export interface SanitizedFinancialPacket {
  schemaVersion: 'clearledger-zero-pii-v1';
  privacyMode: 'aggregated_amounts' | 'ratios_and_bands_only';
  currency: CurrencyCode;
  monthsAnalyzed: number;
  incomeBand: string;
  ratios: {
    essentialPctOfIncome: number;
    nonEssentialPctOfIncome: number;
    currentSavingsRatePct: number;
    projectedSavingsRateWithCutsPct: number;
  };
  monthlyAveragesRounded?: {
    netIncome: number;
    essentialSpend: number;
    nonEssentialSpend: number;
    currentSurplus: number;
    identifiedMonthlyCuts: number;
    totalPotentialMonthlySavings: number;
  };
  recurringSignals: {
    recurringBillCount: number;
    discretionarySubscriptionCount: number;
    billsWithPriceHikeCount: number;
    avgPriceHikePct: number;
    flaggedToCancelOrNegotiateCount: number;
  };
  categoryBreakdown: SanitizedCategoryMetric[];
  isaStrategy: {
    horizonYears: number;
    taxBand: IsaPlannerSettings['taxBand'];
    cashIsaRatePct: number;
    stocksIsaRatePct: number;
    lisaRatePct: number;
    splitPct: {
      cashIsa: number;
      lifetimeIsa: number;
      stocksIsa: number;
    };
    isaAnnualCapUsagePct: number;
    projectedFinalCashIsaRounded?: number;
    projectedFinalBlendedIsaRounded?: number;
    estimatedTaxAndBonusBenefitRounded?: number;
  };
  goals: SanitizedGoalMetric[];
}

export interface AiAdvisorResponse {
  executiveSummary: string;
  directAnswer?: string;
  priorityActions: Array<{
    title: string;
    category: string;
    estimatedImpact: string;
    steps: string;
  }>;
  isaAllocationGuidance: string;
  blindSpotsAndRisks: string[];
  modelUsed: string;
}

function getIncomeBand(monthlyIncome: number, currency: CurrencyCode): string {
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
  if (monthlyIncome < 2000) return `Under ${sym}2,000/mo`;
  if (monthlyIncome < 3500) return `${sym}2,000–${sym}3,500/mo`;
  if (monthlyIncome < 5000) return `${sym}3,500–${sym}5,000/mo`;
  if (monthlyIncome < 7500) return `${sym}5,000–${sym}7,500/mo`;
  return `Above ${sym}7,500/mo`;
}

function roundToNearest10(val: number): number {
  return Math.round(val / 10) * 10;
}

export function buildSanitizedAiPacket(
  analytics: AnalyticsResult,
  isaSettings: IsaPlannerSettings,
  goals: SavingsGoal[],
  currency: CurrencyCode,
  ratiosOnly: boolean
): SanitizedFinancialPacket {
  const essentialPctOfIncome =
    analytics.avgMonthlyIncome > 0
      ? Math.round((analytics.avgMonthlyEssential / analytics.avgMonthlyIncome) * 1000) / 10
      : 0;
  const nonEssentialPctOfIncome =
    analytics.avgMonthlyIncome > 0
      ? Math.round((analytics.avgMonthlyNonEssential / analytics.avgMonthlyIncome) * 1000) / 10
      : 0;
  const potentialMonthly =
    analytics.avgMonthlySurplus + analytics.totalRecommendedMonthlySavings;
  const projectedSavingsRateWithCutsPct =
    analytics.avgMonthlyIncome > 0
      ? Math.round((potentialMonthly / analytics.avgMonthlyIncome) * 1000) / 10
      : 0;

  const activeContribution =
    isaSettings.customMonthlyOverride !== null
      ? isaSettings.customMonthlyOverride
      : Math.round(potentialMonthly);

  const proj = computeWealthProjections(activeContribution, isaSettings);

  const hiked = analytics.recurringItems.filter((r) => (r.priceIncreasePct ?? 0) > 0);
  const avgHike =
    hiked.length > 0
      ? Math.round(
          hiked.reduce((s, r) => s + (r.priceIncreasePct ?? 0), 0) / hiked.length
        )
      : 0;

  const discretionarySubs = analytics.recurringItems.filter(
    (r) => r.spendingClass === 'non-essential'
  );
  const flaggedCount = analytics.recurringItems.filter((r) => r.action !== 'keep').length;

  const categoryBreakdown: SanitizedCategoryMetric[] = analytics.categoryDrains.map((c) => {
    const item: SanitizedCategoryMetric = {
      category: c.label,
      classification: c.spendingClass === 'essential' ? 'essential' : 'non-essential',
      shareOfSpendingPct: Math.round(c.shareOfSpendingPct * 10) / 10,
      shareOfIncomePct: Math.round(c.shareOfIncomePct * 10) / 10,
      recent3MonthTrendPct: Math.round(c.trendPct),
    };
    if (!ratiosOnly) {
      item.monthlyAverageRounded = roundToNearest10(c.monthlyAverage);
    }
    return item;
  });

  const sanitizedGoals: SanitizedGoalMetric[] = goals.map((g, idx) => {
    const gm: SanitizedGoalMetric = {
      label: `Goal ${idx + 1} (${g.vehicle.replace('_', ' ')})`,
      vehicle: g.vehicle,
      fundedPct: Math.min(100, Math.round((g.currentSaved / Math.max(g.targetAmount, 1)) * 100)),
      monthlyAllocationPct: g.monthlyAllocationPct,
    };
    if (!ratiosOnly) {
      gm.targetAmountRounded = roundToNearest10(g.targetAmount);
    }
    return gm;
  });

  const packet: SanitizedFinancialPacket = {
    schemaVersion: 'clearledger-zero-pii-v1',
    privacyMode: ratiosOnly ? 'ratios_and_bands_only' : 'aggregated_amounts',
    currency,
    monthsAnalyzed: analytics.monthCount,
    incomeBand: getIncomeBand(analytics.avgMonthlyIncome, currency),
    ratios: {
      essentialPctOfIncome,
      nonEssentialPctOfIncome,
      currentSavingsRatePct: Math.round(analytics.savingsRatePct * 10) / 10,
      projectedSavingsRateWithCutsPct,
    },
    recurringSignals: {
      recurringBillCount: analytics.recurringItems.length,
      discretionarySubscriptionCount: discretionarySubs.length,
      billsWithPriceHikeCount: hiked.length,
      avgPriceHikePct: avgHike,
      flaggedToCancelOrNegotiateCount: flaggedCount,
    },
    categoryBreakdown,
    isaStrategy: {
      horizonYears: isaSettings.horizonYears,
      taxBand: isaSettings.taxBand,
      cashIsaRatePct: isaSettings.cashIsaRate,
      stocksIsaRatePct: isaSettings.stocksIsaRate,
      lisaRatePct: isaSettings.lisaRate,
      splitPct: {
        cashIsa: isaSettings.cashIsaSplitPct,
        lifetimeIsa: isaSettings.lisaSplitPct,
        stocksIsa: isaSettings.stocksIsaSplitPct,
      },
      isaAnnualCapUsagePct: Math.round(proj.isaAllowanceUsedPct),
    },
    goals: sanitizedGoals,
  };

  if (!ratiosOnly) {
    packet.monthlyAveragesRounded = {
      netIncome: roundToNearest10(analytics.avgMonthlyIncome),
      essentialSpend: roundToNearest10(analytics.avgMonthlyEssential),
      nonEssentialSpend: roundToNearest10(analytics.avgMonthlyNonEssential),
      currentSurplus: roundToNearest10(analytics.avgMonthlySurplus),
      identifiedMonthlyCuts: roundToNearest10(analytics.totalRecommendedMonthlySavings),
      totalPotentialMonthlySavings: roundToNearest10(potentialMonthly),
    };
    packet.isaStrategy.projectedFinalCashIsaRounded = roundToNearest10(proj.finalCashIsa);
    packet.isaStrategy.projectedFinalBlendedIsaRounded = roundToNearest10(proj.finalBlendedIsa);
    packet.isaStrategy.estimatedTaxAndBonusBenefitRounded = roundToNearest10(
      proj.taxSavedTotal + proj.lisaGovtBonusTotal
    );
  }

  return packet;
}
