import {
  CATEGORIES,
  DEFAULT_EXCHANGE_RATES,
  type AiProviderSetting,
} from '../types/finance';
import type { SanitizedFinancialPacket } from './privacySanitizer';

type Check = (value: unknown) => boolean;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactShape(
  value: unknown,
  required: Record<string, Check>,
  optional: Record<string, Check> = {}
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const allowed = { ...required, ...optional };
  if (!Object.keys(required).every((key) => Object.hasOwn(value, key))) return false;
  return Object.entries(value).every(([key, field]) =>
    Object.hasOwn(allowed, key) && allowed[key](field)
  );
}

const finiteNumber: Check = (value) =>
  typeof value === 'number' && Number.isFinite(value);
const nonNegativeInteger: Check = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const oneOf = (choices: readonly string[]): Check =>
  (value) => typeof value === 'string' && choices.includes(value);

const currencyCodes = Object.keys(DEFAULT_EXCHANGE_RATES);
const categoryLabels = Object.values(CATEGORIES).map((category) => category.label);
const goalVehicles = ['cash_isa', 'lifetime_isa', 'stocks_isa', 'emergency_fund'];
const taxBands = ['basic_20', 'higher_40', 'additional_45'];

function validIncomeBand(value: unknown, currency: unknown): boolean {
  if (typeof value !== 'string' || typeof currency !== 'string') return false;
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
  return [
    `Under ${symbol}2,000/mo`,
    `${symbol}2,000–${symbol}3,500/mo`,
    `${symbol}3,500–${symbol}5,000/mo`,
    `${symbol}5,000–${symbol}7,500/mo`,
    `Above ${symbol}7,500/mo`,
  ].includes(value);
}

const validRatios: Check = (value) => exactShape(value, {
  essentialPctOfIncome: finiteNumber,
  nonEssentialPctOfIncome: finiteNumber,
  currentSavingsRatePct: finiteNumber,
  projectedSavingsRateWithCutsPct: finiteNumber,
});

const validMonthlyAverages: Check = (value) => exactShape(value, {
  netIncome: finiteNumber,
  essentialSpend: finiteNumber,
  nonEssentialSpend: finiteNumber,
  currentSurplus: finiteNumber,
  identifiedMonthlyCuts: finiteNumber,
  totalPotentialMonthlySavings: finiteNumber,
});

const validRecurringSignals: Check = (value) => exactShape(value, {
  recurringBillCount: nonNegativeInteger,
  discretionarySubscriptionCount: nonNegativeInteger,
  billsWithPriceHikeCount: nonNegativeInteger,
  avgPriceHikePct: finiteNumber,
  flaggedToCancelOrNegotiateCount: nonNegativeInteger,
});

const validCategory: Check = (value) => exactShape(value, {
  category: oneOf(categoryLabels),
  classification: oneOf(['essential', 'non-essential']),
  shareOfSpendingPct: finiteNumber,
  shareOfIncomePct: finiteNumber,
  recent3MonthTrendPct: finiteNumber,
}, {
  monthlyAverageRounded: finiteNumber,
});

const validIsaStrategy: Check = (value) => exactShape(value, {
  horizonYears: finiteNumber,
  taxBand: oneOf(taxBands),
  cashIsaRatePct: finiteNumber,
  stocksIsaRatePct: finiteNumber,
  lisaRatePct: finiteNumber,
  splitPct: (split) => exactShape(split, {
    cashIsa: finiteNumber,
    lifetimeIsa: finiteNumber,
    stocksIsa: finiteNumber,
  }),
  isaAnnualCapUsagePct: finiteNumber,
}, {
  projectedFinalCashIsaRounded: finiteNumber,
  projectedFinalBlendedIsaRounded: finiteNumber,
  estimatedTaxAndBonusBenefitRounded: finiteNumber,
});

function validGoals(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 100) return false;
  return value.every((goal, index) => exactShape(goal, {
    label: (label) =>
      typeof label === 'string' &&
      isRecord(goal) &&
      typeof goal.vehicle === 'string' &&
      label === `Goal ${index + 1} (${goal.vehicle.replace('_', ' ')})`,
    vehicle: oneOf(goalVehicles),
    fundedPct: finiteNumber,
    monthlyAllocationPct: finiteNumber,
  }, {
    targetAmountRounded: finiteNumber,
  }));
}

/** Validate every nested field before the local proxy forwards a summary to an AI provider. */
export function validateSanitizedPacket(
  raw: unknown
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const valid = exactShape(raw, {
    schemaVersion: oneOf(['clearledger-zero-pii-v1']),
    privacyMode: oneOf(['aggregated_amounts', 'ratios_and_bands_only']),
    currency: oneOf(currencyCodes),
    monthsAnalyzed: nonNegativeInteger,
    incomeBand: (value) => isRecord(raw) && validIncomeBand(value, raw.currency),
    ratios: validRatios,
    recurringSignals: validRecurringSignals,
    categoryBreakdown: (value) =>
      Array.isArray(value) && value.length <= 25 && value.every(validCategory),
    isaStrategy: validIsaStrategy,
    goals: validGoals,
  }, {
    monthlyAveragesRounded: validMonthlyAverages,
  });

  if (!valid) {
    return { ok: false, error: 'Invalid summary schema. Only the locally generated financial summary is accepted.' };
  }

  const aggregated = raw.privacyMode === 'aggregated_amounts';
  const hasAmounts = Object.hasOwn(raw, 'monthlyAveragesRounded');
  const categories = raw.categoryBreakdown as Array<Record<string, unknown>>;
  const goals = raw.goals as Array<Record<string, unknown>>;
  const strategy = raw.isaStrategy as Record<string, unknown>;
  const optionalStrategyAmounts = [
    'projectedFinalCashIsaRounded',
    'projectedFinalBlendedIsaRounded',
    'estimatedTaxAndBonusBenefitRounded',
  ];
  if (
    hasAmounts !== aggregated ||
    categories.some((category) => Object.hasOwn(category, 'monthlyAverageRounded') !== aggregated) ||
    goals.some((goal) => Object.hasOwn(goal, 'targetAmountRounded') !== aggregated) ||
    optionalStrategyAmounts.some((key) => Object.hasOwn(strategy, key) !== aggregated)
  ) {
    return { ok: false, error: 'Summary amounts do not match the selected privacy mode.' };
  }

  return { ok: true, data: raw };
}

export function buildAdvisorRequestJson(
  provider: AiProviderSetting,
  summary: SanitizedFinancialPacket,
  question: string
): string {
  return JSON.stringify({ provider, summary, question: question.trim().slice(0, 500) }, null, 2);
}
