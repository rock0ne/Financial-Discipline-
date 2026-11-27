export type SpendingClass = 'essential' | 'non-essential' | 'income' | 'savings';

export type SubscriptionClass = 'essential' | 'cancelable';

export type AiProviderId = 'gemini' | 'claude' | 'chatgpt';
export type AiProviderSetting = 'off' | AiProviderId;
export type AiRetentionOption = 'single' | '15m' | '1h' | '7d' | '30d';

export interface AiAssistantSettings {
  provider: AiProviderSetting;
  retention: AiRetentionOption;
  expiresAt: number | null; // epoch ms when auto-off triggers (null for 'off' or 'single')
  ratiosOnly: boolean;
}

export type CategoryId =
  | 'salary_income'
  | 'other_income'
  | 'housing'
  | 'utilities'
  | 'groceries'
  | 'transport'
  | 'insurance_health'
  | 'dining_takeaway'
  | 'subscriptions'
  | 'shopping_retail'
  | 'coffee_convenience'
  | 'entertainment_leisure'
  | 'travel_holidays'
  | 'savings_investment'
  | 'other_discretionary';

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  defaultClass: SpendingClass;
  color: string;
  darkColor: string;
  benchmarkPct?: number; // Reference % of net income
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  merchant: string;
  amount: number; // Positive for income, negative for outflows (in native `currency`)
  currency?: CurrencyCode; // Original statement currency; defaults to vault display currency if unset
  category: CategoryId;
  spendingClass: SpendingClass;
  accountName: string;
  sourceFile?: string;
  importBatchId?: string;
  isRecurring?: boolean;
  notes?: string;
}

export interface StatementImportMeta {
  id: string;
  fileName: string;
  importedAt: string;
  rowCount: number;
  duplicatesSkipped: number;
  dateRangeStart: string;
  dateRangeEnd: string;
}

export interface MonthlyBreakdown {
  monthKey: string; // YYYY-MM
  label: string; // e.g., "Nov 25"
  income: number;
  essential: number;
  nonEssential: number;
  savingsTransfer: number;
  totalSpending: number;
  netCashFlow: number;
  savingsRate: number;
}

export interface CategoryDrain {
  categoryId: CategoryId;
  label: string;
  spendingClass: SpendingClass;
  totalAmount: number;
  monthlyAverage: number;
  monthsObserved: number;
  shareOfSpendingPct: number;
  shareOfIncomePct: number;
  transactionCount: number;
  trendPct: number; // Recent 3 months vs prior average
  color: string;
}

export interface CategoryCapStatus {
  categoryId: CategoryId;
  label: string;
  spendingClass: SpendingClass;
  monthlyAverage: number;
  monthsObserved: number;
  latestMonthActual: number;
  monthlyCap: number | null;
  variance: number; // monthlyAverage - monthlyCap (positive = over cap)
  utilizationPct: number; // 0..200+
  status: 'over' | 'near' | 'under' | 'unset';
}

export interface CapPaceAlert {
  categoryId: CategoryId;
  label: string;
  monthKey: string;
  monthLabel: string;
  spentToDate: number;
  projectedMonthEnd: number;
  monthlyCap: number;
  projectedOverage: number;
  projectedPctOfCap: number;
  elapsedDays: number;
  daysInMonth: number;
  daysRemaining: number;
}

export interface CategoryVarianceProjection {
  categoryId: CategoryId;
  label: string;
  spendingClass: SpendingClass;
  monthsObserved: number;
  historicalMean: number;
  stdDev: number;
  coefficientOfVariation: number;
  trendSlopePerMonth: number;
  projectedNextMonth: number;
  lowerBoundSpend: number;
  upperBoundSpend: number;
  monthlyCap: number | null;
  projectedVsLimitDelta: number | null;
  upperVsLimitDelta: number | null;
  partialMonthActual: number | null;
  partialMonthProRated: number | null;
  riskStatus: 'projected_over' | 'variance_risk' | 'on_track' | 'insufficient_data' | 'uncapped';
}

export interface SpendingTrendProjectionSummary {
  nextMonthLabel: string;
  monthsAnalyzed: number;
  partialMonthMode: 'none' | 'excluded' | 'prorated';
  partialMonthKey: string | null;
  partialMonthLabel: string | null;
  partialMonthDaysElapsed: number | null;
  partialMonthDaysInMonth: number | null;
  excludedPartialMonth: string | null;
  excludedPartialMonthLabel: string | null;
  excludedPartialMonthDaysElapsed: number | null;
  totalProjectedNextMonth: number;
  totalUpperBound: number;
  totalHistoricalMean: number;
  projectedDeltaPct: number;
  projectedOverLimitCount: number;
  varianceRiskCount: number;
  categories: CategoryVarianceProjection[];
}

export interface MerchantDrain {
  merchant: string;
  categoryId: CategoryId;
  categoryLabel: string;
  spendingClass: SpendingClass;
  totalAmount: number;
  monthlyAverage: number;
  transactionCount: number;
  avgTicket: number;
  isRecurring: boolean;
  priceHikeDetected?: {
    from: number;
    to: number;
    pctIncrease: number;
  };
}

export interface RecurringItem {
  id: string;
  merchant: string;
  categoryId: CategoryId;
  categoryLabel: string;
  spendingClass: SpendingClass;
  subscriptionClass: SubscriptionClass;
  monthlyCost: number;
  annualCost: number;
  occurrences: number;
  lastDate: string;
  cadence: 'Monthly' | 'Quarterly' | 'Weekly';
  priceIncreasePct?: number;
  action: 'keep' | 'downgrade' | 'cancel';
  potentialMonthlySaving: number;
}

export interface UpcomingBill {
  id: string;
  merchant: string;
  categoryId: CategoryId;
  categoryLabel: string;
  spendingClass: SpendingClass;
  cadence: 'Weekly' | 'Bi-weekly' | 'Monthly' | 'Quarterly';
  dueDate: string; // YYYY-MM-DD
  daysUntilDue: number; // 0..windowDays
  expectedAmount: number; // Converted to primary display currency
  nativeAmount: number;
  nativeCurrency: CurrencyCode;
  occurrences: number;
  typicalDayOfMonth?: number;
  lastPaidDate: string;
  markedForCancel: boolean;
}

export interface UpcomingBillsSummary {
  windowDays: number;
  referenceDate: string; // YYYY-MM-DD
  windowEndDate: string; // YYYY-MM-DD
  dueSoon: UpcomingBill[];
  nextAfterWindow: UpcomingBill | null;
  totalDueSoon: number;
  essentialDueSoon: number;
  nonEssentialDueSoon: number;
  cancelableDueSoon: number;
}

export interface SavingsRecommendation {
  id: string;
  title: string;
  rationale: string;
  categoryId: CategoryId;
  currentMonthly: number;
  suggestedCutPct: number; // 0 to 100
  activeCutPct: number;
  enabled: boolean;
  effort: 'Low effort' | 'Moderate' | 'Lifestyle shift';
}

export type SavingsVehicleId = 'cash_isa' | 'lifetime_isa' | 'stocks_isa' | 'emergency_fund';

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentSaved: number;
  vehicle: SavingsVehicleId;
  monthlyAllocationPct: number; // % of total monthly savings pot
}

export type CurrencyCode = 'GBP' | 'USD' | 'EUR' | 'CAD' | 'AUD' | 'CHF' | 'JPY';

/** Internal offline exchange rate table: units of currency per 1 GBP */
export type ExchangeRateTable = Record<CurrencyCode, number>;

export const DEFAULT_EXCHANGE_RATES: ExchangeRateTable = {
  GBP: 1,
  USD: 1.27,
  EUR: 1.18,
  CAD: 1.75,
  AUD: 1.94,
  CHF: 1.12,
  JPY: 194,
};

export type TaxBand = 'basic_20' | 'higher_40' | 'additional_45';

export interface IsaPlannerSettings {
  cashIsaRate: number; // % AER e.g. 4.85
  currentAccountRate: number; // % AER e.g. 0.5
  stocksIsaRate: number; // % expected annual return e.g. 7.0
  lisaRate: number; // % AER e.g. 4.5 (+ 25% govt bonus)
  horizonYears: number; // 1, 3, 5, 10, 20
  taxBand: TaxBand;
  cashIsaSplitPct: number; // % of monthly savings to Cash ISA
  lisaSplitPct: number; // % to LISA (capped at £4k/yr)
  stocksIsaSplitPct: number; // % to S&S ISA
  customMonthlyOverride: number | null; // null = use live surplus + active cuts
}

export interface CategoryRule {
  id: string;
  matchPattern: string; // normalized lowercase merchant or description token
  matchType: 'exact_merchant' | 'contains_keyword' | 'recurring_pattern';
  category: CategoryId;
  spendingClass: SpendingClass;
  source: 'user_label' | 'recurring_pattern' | 'manual';
  confidence: number; // 0..100
  matchCount: number;
  updatedAt: string;
}

export interface CategoryRuleSuggestion {
  transactionId: string;
  merchant: string;
  description: string;
  date: string;
  amount: number;
  currentCategory: CategoryId;
  suggestedCategory: CategoryId;
  suggestedClass: SpendingClass;
  reason: string;
  ruleSource: CategoryRule['source'];
  confidence: number;
  matchPattern: string;
}

export type PlannerHorizon = 'yearly' | 'monthly' | 'weekly' | 'daily';

export interface PlannerGoalItem {
  id: string;
  horizon: PlannerHorizon;
  title: string;
  targetNote: string;
  completed: boolean;
  createdAt: string;
}

export interface StruggleEntry {
  id: string;
  date: string;
  trigger: string;
  responsePlan: string;
}

export interface PersonalPlannerState {
  commitmentDeclaration: string;
  commitmentSignedName: string;
  commitmentUpdatedAt: string;
  struggles: StruggleEntry[];
  plannerGoals: PlannerGoalItem[];
}

export type DebtCategory =
  | 'credit_card'
  | 'personal_loan'
  | 'car_finance'
  | 'overdraft'
  | 'bnpl'
  | 'other';

export interface DebtAccount {
  id: string;
  name: string;
  balance: number;
  apr: number; // Annual percentage rate (e.g., 22.9)
  minimumPayment: number;
  category: DebtCategory;
}

export type AmountOperator = 'any' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';

export interface AdvancedAutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  merchantContains: string;
  amountOperator: AmountOperator;
  amountValue?: number;
  amountMax?: number;
  currencyFilter?: CurrencyCode | 'any';
  targetCategory?: CategoryId;
  targetSpendingClass: SpendingClass;
  createdAt: string;
}

export type SmartTagId = 'tax_deductible' | 'expense_claimable';

export interface SmartTagMatch {
  tag: SmartTagId;
  label: string;
  reason: string;
  matchedPattern: string;
}

export interface SmartTagSummary {
  byTransactionId: Record<string, SmartTagMatch[]>;
  taxDeductibleCount: number;
  expenseClaimableCount: number;
  eitherTagCount: number;
  taxDeductibleTotal: number;
  expenseClaimableTotal: number;
  eitherTagTotal: number;
}

export type NetWorthDebtStrategy = 'avalanche' | 'snowball' | 'minimums_only';

export interface NetWorthProjectionPoint {
  month: number; // 0..60
  label: string; // 'Now', 'Yr 1', 'M18', etc.
  dateLabel: string; // e.g., 'Nov 2026'
  assets: number;
  debt: number;
  netWorth: number;
  baselineNetWorth: number;
  cumulativeContributions: number;
  cumulativeGrowth: number;
  cumulativeDebtPaid: number;
}

export interface FiveYearNetWorthProjection {
  startingSavings: number;
  startingDebt: number;
  startingNetWorth: number;
  projectedAssets5Y: number;
  projectedDebt5Y: number;
  projectedNetWorth5Y: number;
  baselineNetWorth5Y: number;
  netWorthGain5Y: number;
  totalInvestmentGrowth5Y: number;
  totalDebtReduced5Y: number;
  totalInterestPaid5Y: number;
  blendedAnnualReturnPct: number;
  monthlySavingsContribution: number;
  extraMonthlyDebtPayment: number;
  totalMinimumDebtPayment: number;
  debtFreeMonth: number | null;
  debtFreeDateLabel: string | null;
  zeroCrossMonth: number | null;
  points: NetWorthProjectionPoint[];
}

export interface VaultPayload {
  version: 1;
  updatedAt: string;
  currency: CurrencyCode;
  exchangeRates?: Partial<ExchangeRateTable>;
  isSampleData: boolean;
  transactions: Transaction[];
  imports: StatementImportMeta[];
  recurringActions: Record<string, 'keep' | 'downgrade' | 'cancel'>;
  subscriptionClassOverrides?: Record<string, SubscriptionClass>;
  categoryCaps?: Partial<Record<CategoryId, number>>;
  categoryRules?: CategoryRule[];
  advancedRules?: AdvancedAutomationRule[];
  plannerState?: PersonalPlannerState;
  debts?: DebtAccount[];
  recommendationOverrides: Record<string, { enabled: boolean; activeCutPct: number }>;
  goals: SavingsGoal[];
  isaSettings: IsaPlannerSettings;
}

export interface EncryptedVaultEnvelope {
  format: 'clearledger-e2ee-v1';
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
  updatedAt: string;
  byteLength: number;
}

export const CATEGORIES: Record<CategoryId, CategoryMeta> = {
  salary_income: {
    id: 'salary_income',
    label: 'Salary & Payroll',
    defaultClass: 'income',
    color: '#059669',
    darkColor: '#34d399',
  },
  other_income: {
    id: 'other_income',
    label: 'Dividends, Refunds & Side Income',
    defaultClass: 'income',
    color: '#10b981',
    darkColor: '#6ee7b7',
  },
  housing: {
    id: 'housing',
    label: 'Housing & Council Tax',
    defaultClass: 'essential',
    color: '#334155',
    darkColor: '#94a3b8',
    benchmarkPct: 28,
  },
  utilities: {
    id: 'utilities',
    label: 'Energy, Water & Broadband',
    defaultClass: 'essential',
    color: '#475569',
    darkColor: '#cbd5e1',
    benchmarkPct: 7,
  },
  groceries: {
    id: 'groceries',
    label: 'Groceries & Household',
    defaultClass: 'essential',
    color: '#0f766e',
    darkColor: '#2dd4bf',
    benchmarkPct: 10,
  },
  transport: {
    id: 'transport',
    label: 'Commute, Rail & Fuel',
    defaultClass: 'essential',
    color: '#64748b',
    darkColor: '#94a3b8',
    benchmarkPct: 6,
  },
  insurance_health: {
    id: 'insurance_health',
    label: 'Insurance, Pharmacy & Health',
    defaultClass: 'essential',
    color: '#0369a1',
    darkColor: '#38bdf8',
    benchmarkPct: 4,
  },
  dining_takeaway: {
    id: 'dining_takeaway',
    label: 'Dining Out & Takeaways',
    defaultClass: 'non-essential',
    color: '#d97706',
    darkColor: '#fbbf24',
    benchmarkPct: 5,
  },
  subscriptions: {
    id: 'subscriptions',
    label: 'Subscriptions & Memberships',
    defaultClass: 'non-essential',
    color: '#dc2626',
    darkColor: '#f87171',
    benchmarkPct: 2,
  },
  shopping_retail: {
    id: 'shopping_retail',
    label: 'Online Retail & Apparel',
    defaultClass: 'non-essential',
    color: '#b45309',
    darkColor: '#f59e0b',
    benchmarkPct: 5,
  },
  coffee_convenience: {
    id: 'coffee_convenience',
    label: 'Coffee, Cafes & Convenience',
    defaultClass: 'non-essential',
    color: '#ea580c',
    darkColor: '#fb923c',
    benchmarkPct: 2,
  },
  entertainment_leisure: {
    id: 'entertainment_leisure',
    label: 'Entertainment & Social',
    defaultClass: 'non-essential',
    color: '#4f46e5',
    darkColor: '#818cf8',
    benchmarkPct: 4,
  },
  travel_holidays: {
    id: 'travel_holidays',
    label: 'Travel & Weekends Away',
    defaultClass: 'non-essential',
    color: '#0284c7',
    darkColor: '#38bdf8',
    benchmarkPct: 5,
  },
  other_discretionary: {
    id: 'other_discretionary',
    label: 'Other Discretionary',
    defaultClass: 'non-essential',
    color: '#94a3b8',
    darkColor: '#64748b',
    benchmarkPct: 3,
  },
  savings_investment: {
    id: 'savings_investment',
    label: 'ISA & Savings Transfers',
    defaultClass: 'savings',
    color: '#0d9488',
    darkColor: '#14b8a6',
    benchmarkPct: 20,
  },
};

export const SPENDING_CATEGORY_IDS: CategoryId[] = [
  'housing',
  'utilities',
  'groceries',
  'transport',
  'insurance_health',
  'dining_takeaway',
  'subscriptions',
  'shopping_retail',
  'coffee_convenience',
  'entertainment_leisure',
  'travel_holidays',
  'other_discretionary',
];

export const CURRENCY_CONFIG: Record<
  CurrencyCode,
  { symbol: string; locale: string; label: string; name: string }
> = {
  GBP: { symbol: '£', locale: 'en-GB', label: 'GBP (£)', name: 'British Pound' },
  USD: { symbol: '$', locale: 'en-US', label: 'USD ($)', name: 'US Dollar' },
  EUR: { symbol: '€', locale: 'de-DE', label: 'EUR (€)', name: 'Euro' },
  CAD: { symbol: 'C$', locale: 'en-CA', label: 'CAD (C$)', name: 'Canadian Dollar' },
  AUD: { symbol: 'A$', locale: 'en-AU', label: 'AUD (A$)', name: 'Australian Dollar' },
  CHF: { symbol: 'CHF ', locale: 'de-CH', label: 'CHF', name: 'Swiss Franc' },
  JPY: { symbol: '¥', locale: 'ja-JP', label: 'JPY (¥)', name: 'Japanese Yen' },
};

export function convertAmount(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates?: Partial<ExchangeRateTable>
): number {
  if (fromCurrency === toCurrency) return amount;
  const fromRate = rates?.[fromCurrency] ?? DEFAULT_EXCHANGE_RATES[fromCurrency] ?? 1;
  const toRate = rates?.[toCurrency] ?? DEFAULT_EXCHANGE_RATES[toCurrency] ?? 1;
  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
    return amount;
  }
  return (amount / fromRate) * toRate;
}

export function getTransactionDisplayAmount(
  tx: Pick<Transaction, 'amount' | 'currency'>,
  primaryCurrency: CurrencyCode,
  rates?: Partial<ExchangeRateTable>
): number {
  const txCurrency = tx.currency ?? primaryCurrency;
  return convertAmount(tx.amount, txCurrency, primaryCurrency, rates);
}

export function formatMoney(
  amount: number,
  currency: CurrencyCode = 'GBP',
  decimals = 0
): string {
  const { symbol } = CURRENCY_CONFIG[currency];
  const effectiveDecimals = currency === 'JPY' ? 0 : decimals;
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-GB', {
    minimumFractionDigits: effectiveDecimals,
    maximumFractionDigits: effectiveDecimals,
  });
  return amount < 0 ? `-${symbol}${formatted}` : `${symbol}${formatted}`;
}
