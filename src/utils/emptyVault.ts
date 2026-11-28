import { DEFAULT_EXCHANGE_RATES, type VaultPayload } from '../types/finance';

/** A new installation contains no fictional transactions or household assumptions. */
export function createEmptyVault(): VaultPayload {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    currency: 'GBP',
    exchangeRates: { ...DEFAULT_EXCHANGE_RATES },
    isSampleData: false,
    transactions: [],
    imports: [],
    recurringActions: {},
    subscriptionClassOverrides: {},
    categoryCaps: {},
    categoryRules: [],
    advancedRules: [],
    plannerState: {
      commitmentDeclaration: '',
      commitmentSignedName: '',
      commitmentUpdatedAt: '',
      struggles: [],
      plannerGoals: [],
    },
    debts: [],
    recommendationOverrides: {},
    goals: [],
    isaSettings: {
      cashIsaRate: 0,
      currentAccountRate: 0,
      stocksIsaRate: 0,
      lisaRate: 0,
      horizonYears: 5,
      taxBand: 'basic_20',
      cashIsaSplitPct: 100,
      lisaSplitPct: 0,
      stocksIsaSplitPct: 0,
      customMonthlyOverride: null,
    },
  };
}
