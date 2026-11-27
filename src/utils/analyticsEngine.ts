import {
  CATEGORIES,
  SPENDING_CATEGORY_IDS,
  convertAmount,
  formatMoney,
  getTransactionDisplayAmount,
  type AdvancedAutomationRule,
  type CapPaceAlert,
  type CategoryCapStatus,
  type CategoryDrain,
  type CategoryId,
  type CategoryRule,
  type CategoryRuleSuggestion,
  type CategoryVarianceProjection,
  type CurrencyCode,
  type DebtAccount,
  type ExchangeRateTable,
  type FiveYearNetWorthProjection,
  type IsaPlannerSettings,
  type MerchantDrain,
  type MonthlyBreakdown,
  type NetWorthDebtStrategy,
  type NetWorthProjectionPoint,
  type RecurringItem,
  type SavingsGoal,
  type SavingsRecommendation,
  type SmartTagId,
  type SmartTagMatch,
  type SmartTagSummary,
  type SpendingTrendProjectionSummary,
  type SubscriptionClass,
  type Transaction,
  type UpcomingBill,
  type UpcomingBillsSummary,
} from '../types/finance';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const idx = parseInt(m, 10) - 1;
  return `${MONTH_NAMES[idx] ?? m} ${y.slice(2)}`;
}

export interface CurrencyBreakdownItem {
  currency: CurrencyCode;
  transactionCount: number;
  nativeOutflows: number;
  convertedOutflows: number;
  nativeInflows: number;
  convertedInflows: number;
}

export interface AnalyticsResult {
  monthCount: number;
  baselineMonthCount: number;
  excludedPartialMonth: string | null;
  excludedPartialMonthLabel: string | null;
  dateRangeLabel: string;
  monthlySeries: MonthlyBreakdown[];
  totalIncome: number;
  totalSpending: number;
  totalEssential: number;
  totalNonEssential: number;
  totalSavingsTransferred: number;
  avgMonthlyIncome: number;
  avgMonthlySpending: number;
  avgMonthlyEssential: number;
  avgMonthlyNonEssential: number;
  avgMonthlySavingsTransfer: number;
  avgMonthlySurplus: number; // Income - TotalSpending (includes transfers to savings)
  essentialSharePct: number;
  nonEssentialSharePct: number;
  savingsRatePct: number;
  categoryDrains: CategoryDrain[];
  categoryCapStatuses: CategoryCapStatus[];
  totalOverCapMonthly: number;
  merchantDrains: MerchantDrain[];
  recurringItems: RecurringItem[];
  essentialRecurringMonthly: number;
  cancelableRecurringMonthly: number;
  recommendations: SavingsRecommendation[];
  unlockedMonthlyFromCuts: number;
  unlockedMonthlyFromRecurring: number;
  totalRecommendedMonthlySavings: number;
  currencyBreakdown: CurrencyBreakdownItem[];
  upcomingBills: UpcomingBillsSummary;
  spendingTrendProjection: SpendingTrendProjectionSummary;
}

export function runLocalFinancialAnalytics(
  transactions: Transaction[],
  recurringActions: Record<string, 'keep' | 'downgrade' | 'cancel'>,
  recommendationOverrides: Record<string, { enabled: boolean; activeCutPct: number }>,
  timeframeMonths: 'all' | 12 | 6 = 'all',
  subscriptionClassOverrides: Record<string, SubscriptionClass> = {},
  categoryCaps: Partial<Record<CategoryId, number>> = {},
  displayCurrency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>,
  projectionOptions?: VarianceProjectionOptions
): AnalyticsResult {
  if (transactions.length === 0) {
    return {
      monthCount: 0,
      baselineMonthCount: 0,
      excludedPartialMonth: null,
      excludedPartialMonthLabel: null,
      dateRangeLabel: 'No statements loaded',
      monthlySeries: [],
      totalIncome: 0,
      totalSpending: 0,
      totalEssential: 0,
      totalNonEssential: 0,
      totalSavingsTransferred: 0,
      avgMonthlyIncome: 0,
      avgMonthlySpending: 0,
      avgMonthlyEssential: 0,
      avgMonthlyNonEssential: 0,
      avgMonthlySavingsTransfer: 0,
      avgMonthlySurplus: 0,
      essentialSharePct: 0,
      nonEssentialSharePct: 0,
      savingsRatePct: 0,
      categoryDrains: [],
      categoryCapStatuses: [],
      totalOverCapMonthly: 0,
      merchantDrains: [],
      recurringItems: [],
      essentialRecurringMonthly: 0,
      cancelableRecurringMonthly: 0,
      recommendations: [],
      unlockedMonthlyFromCuts: 0,
      unlockedMonthlyFromRecurring: 0,
      totalRecommendedMonthlySavings: 0,
      currencyBreakdown: [],
      upcomingBills: computeUpcomingBills([], displayCurrency, exchangeRates),
      spendingTrendProjection: computeCategoryVarianceProjections(
        [],
        categoryCaps,
        displayCurrency,
        exchangeRates,
        projectionOptions
      ),
    };
  }

  // Group all available months sorted chronologically
  const allMonthKeys = Array.from(new Set(transactions.map((t) => t.date.slice(0, 7)))).sort();
  const activeMonthKeys =
    timeframeMonths === 'all'
      ? allMonthKeys
      : allMonthKeys.slice(-timeframeMonths);

  const activeMonthSet = new Set(activeMonthKeys);
  const latestMonthKey = activeMonthKeys[activeMonthKeys.length - 1];
  const filteredTx = transactions.filter((t) => activeMonthSet.has(t.date.slice(0, 7)));
  const monthCount = Math.max(activeMonthKeys.length, 1);

  // Identify incomplete trailing month so baseline averages are not biased low
  const maxDayByMonth = new Map<string, number>();
  for (const tx of filteredTx) {
    const mk = tx.date.slice(0, 7);
    const dayNum = parseInt(tx.date.slice(8, 10), 10);
    if (Number.isFinite(dayNum) && dayNum >= 1 && dayNum <= 31) {
      const prevMax = maxDayByMonth.get(mk) ?? 0;
      if (dayNum > prevMax) maxDayByMonth.set(mk, dayNum);
    }
  }

  const refDate = projectionOptions?.referenceDate ?? new Date();
  const excludePartialTrailing = projectionOptions?.excludePartialTrailingMonth ?? true;
  const priorMaxDays = activeMonthKeys
    .slice(0, -1)
    .map((mk) => maxDayByMonth.get(mk) ?? 28);
  const trailingCompleteness = isMonthComplete(
    latestMonthKey,
    maxDayByMonth.get(latestMonthKey) ?? null,
    priorMaxDays,
    refDate
  );

  let excludedPartialMonth: string | null = null;
  let excludedPartialMonthLabel: string | null = null;
  let baselineMonthKeys = activeMonthKeys;

  if (
    excludePartialTrailing &&
    !trailingCompleteness.complete &&
    activeMonthKeys.length >= 2
  ) {
    excludedPartialMonth = latestMonthKey;
    excludedPartialMonthLabel = formatMonthLabel(latestMonthKey);
    baselineMonthKeys = activeMonthKeys.slice(0, -1);
  }

  const baselineMonthSet = new Set(baselineMonthKeys);
  const baselineMonthCount = Math.max(baselineMonthKeys.length, 1);

  const monthMap = new Map<string, MonthlyBreakdown>();
  for (const mk of activeMonthKeys) {
    monthMap.set(mk, {
      monthKey: mk,
      label: formatMonthLabel(mk),
      income: 0,
      essential: 0,
      nonEssential: 0,
      savingsTransfer: 0,
      totalSpending: 0,
      netCashFlow: 0,
      savingsRate: 0,
    });
  }

  // Category & Merchant accumulators (with per-month maps for category-specific history)
  const catTotals = new Map<
    CategoryId,
    {
      total: number;
      count: number;
      recent3: number;
      prior: number;
      latestMonth: number;
      monthly: Map<string, number>;
    }
  >();
  const merchMap = new Map<
    string,
    {
      merchant: string;
      categoryId: CategoryId;
      spendingClass: Transaction['spendingClass'];
      total: number;
      baselineTotal: number;
      count: number;
      months: Map<string, number[]>;
      lastDate: string;
      dates: string[];
    }
  >();

  const recent3Set = new Set(baselineMonthKeys.slice(-3));
  const priorMonthCount = Math.max(baselineMonthKeys.length - 3, 1);
  const recentMonthCount = Math.min(baselineMonthKeys.length, 3);
  const currencyMap = new Map<CurrencyCode, CurrencyBreakdownItem>();

  for (const tx of filteredTx) {
    const mk = tx.date.slice(0, 7);
    const m = monthMap.get(mk);
    if (!m) continue;

    const nativeCurrency: CurrencyCode = tx.currency ?? displayCurrency;
    const convertedAmount = getTransactionDisplayAmount(tx, displayCurrency, exchangeRates);
    const absConverted = Math.abs(convertedAmount);
    const absNative = Math.abs(tx.amount);

    const currEntry = currencyMap.get(nativeCurrency) ?? {
      currency: nativeCurrency,
      transactionCount: 0,
      nativeOutflows: 0,
      convertedOutflows: 0,
      nativeInflows: 0,
      convertedInflows: 0,
    };
    currEntry.transactionCount += 1;
    if (tx.spendingClass === 'income' || tx.amount > 0) {
      currEntry.nativeInflows += absNative;
      currEntry.convertedInflows += absConverted;
    } else if (tx.spendingClass !== 'savings') {
      currEntry.nativeOutflows += absNative;
      currEntry.convertedOutflows += absConverted;
    }
    currencyMap.set(nativeCurrency, currEntry);

    if (tx.spendingClass === 'income' || tx.amount > 0) {
      m.income += absConverted;
    } else if (tx.spendingClass === 'savings') {
      m.savingsTransfer += absConverted;
    } else {
      const absAmt = absConverted;
      if (tx.spendingClass === 'essential') {
        m.essential += absAmt;
      } else {
        m.nonEssential += absAmt;
      }
      m.totalSpending += absAmt;

      // Track category drain & per-month spend
      const prevCat = catTotals.get(tx.category) ?? {
        total: 0,
        count: 0,
        recent3: 0,
        prior: 0,
        latestMonth: 0,
        monthly: new Map<string, number>(),
      };
      prevCat.total += absAmt;
      prevCat.count += 1;
      prevCat.monthly.set(mk, (prevCat.monthly.get(mk) ?? 0) + absAmt);
      if (baselineMonthSet.has(mk)) {
        if (recent3Set.has(mk)) {
          prevCat.recent3 += absAmt;
        } else {
          prevCat.prior += absAmt;
        }
      }
      if (mk === latestMonthKey) {
        prevCat.latestMonth += absAmt;
      }
      catTotals.set(tx.category, prevCat);

      // Track merchant drain
      const mKey = tx.merchant.toLowerCase();
      const prevMerch = merchMap.get(mKey) ?? {
        merchant: tx.merchant,
        categoryId: tx.category,
        spendingClass: tx.spendingClass,
        total: 0,
        baselineTotal: 0,
        count: 0,
        months: new Map<string, number[]>(),
        lastDate: tx.date,
        dates: [],
      };
      prevMerch.total += absAmt;
      if (baselineMonthSet.has(mk)) {
        prevMerch.baselineTotal += absAmt;
      }
      prevMerch.count += 1;
      if (tx.date > prevMerch.lastDate) prevMerch.lastDate = tx.date;
      prevMerch.dates.push(tx.date);
      const monthAmts = prevMerch.months.get(mk) ?? [];
      monthAmts.push(absAmt);
      prevMerch.months.set(mk, monthAmts);
      merchMap.set(mKey, prevMerch);
    }
  }

  const currencyBreakdown = Array.from(currencyMap.values()).sort(
    (a, b) => b.convertedOutflows - a.convertedOutflows
  );

  const monthlySeries = activeMonthKeys.map((mk) => {
    const m = monthMap.get(mk)!;
    m.netCashFlow = m.income - m.totalSpending;
    m.savingsRate = m.income > 0 ? ((m.income - m.totalSpending) / m.income) * 100 : 0;
    return m;
  });

  const baselineSeries = baselineMonthKeys.map((mk) => monthMap.get(mk)!);

  const totalIncome = roundPence(monthlySeries.reduce((s, m) => s + m.income, 0));
  const totalEssential = roundPence(monthlySeries.reduce((s, m) => s + m.essential, 0));
  const totalNonEssential = roundPence(monthlySeries.reduce((s, m) => s + m.nonEssential, 0));
  const totalSpending = roundPence(totalEssential + totalNonEssential);
  const totalSavingsTransferred = roundPence(
    monthlySeries.reduce((s, m) => s + m.savingsTransfer, 0)
  );

  const baselineIncomeTotal = baselineSeries.reduce((s, m) => s + m.income, 0);
  const baselineEssentialTotal = baselineSeries.reduce((s, m) => s + m.essential, 0);
  const baselineNonEssentialTotal = baselineSeries.reduce((s, m) => s + m.nonEssential, 0);
  const baselineSpendingTotal = baselineEssentialTotal + baselineNonEssentialTotal;
  const baselineSavingsTotal = baselineSeries.reduce((s, m) => s + m.savingsTransfer, 0);

  const avgMonthlyIncome = roundPence(baselineIncomeTotal / baselineMonthCount);
  const avgMonthlySpending = roundPence(baselineSpendingTotal / baselineMonthCount);
  const avgMonthlyEssential = roundPence(baselineEssentialTotal / baselineMonthCount);
  const avgMonthlyNonEssential = roundPence(baselineNonEssentialTotal / baselineMonthCount);
  const avgMonthlySavingsTransfer = roundPence(baselineSavingsTotal / baselineMonthCount);
  const avgMonthlySurplus = roundPence(Math.max(0, avgMonthlyIncome - avgMonthlySpending));

  const essentialSharePct =
    baselineSpendingTotal > 0 ? (baselineEssentialTotal / baselineSpendingTotal) * 100 : 0;
  const nonEssentialSharePct =
    baselineSpendingTotal > 0 ? (baselineNonEssentialTotal / baselineSpendingTotal) * 100 : 0;
  const savingsRatePct =
    baselineIncomeTotal > 0
      ? ((baselineIncomeTotal - baselineSpendingTotal) / baselineIncomeTotal) * 100
      : 0;

  // Helper: compute category-specific active history length (`monthsObserved`) & baseline average
  // ignoring leading structural zeros before the category first appeared.
  const computeCategoryBaselineStats = (categoryId: CategoryId) => {
    const data = catTotals.get(categoryId);
    if (!data) {
      return { monthsObserved: 0, baselineTotal: 0, monthlyAverage: 0 };
    }
    const series = baselineMonthKeys.map((mk) => data.monthly.get(mk) ?? 0);
    const firstNonZeroIdx = series.findIndex((v) => v > 0);
    if (firstNonZeroIdx === -1) {
      return { monthsObserved: 0, baselineTotal: 0, monthlyAverage: 0 };
    }
    const activeSlice = series.slice(firstNonZeroIdx);
    const monthsObserved = activeSlice.length;
    const baselineTotal = activeSlice.reduce((s, v) => s + v, 0);
    return {
      monthsObserved,
      baselineTotal: roundPence(baselineTotal),
      monthlyAverage: roundPence(baselineTotal / monthsObserved),
    };
  };

  // Build category drains sorted by spend desc
  const categoryDrains: CategoryDrain[] = Array.from(catTotals.entries())
    .map(([categoryId, data]) => {
      const meta = CATEGORIES[categoryId];
      const { monthsObserved, monthlyAverage } = computeCategoryBaselineStats(categoryId);
      const recentAvg = data.recent3 / Math.max(1, Math.min(monthsObserved || 1, recentMonthCount));
      const priorWindow = Math.max(1, monthsObserved - recentMonthCount);
      const priorAvg =
        baselineMonthKeys.length > 3 && monthsObserved > recentMonthCount
          ? data.prior / Math.min(priorMonthCount, priorWindow)
          : recentAvg;
      const trendPct = priorAvg > 0 ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0;
      return {
        categoryId,
        label: meta.label,
        spendingClass: meta.defaultClass,
        totalAmount: roundPence(data.total),
        monthlyAverage,
        monthsObserved,
        shareOfSpendingPct: totalSpending > 0 ? (data.total / totalSpending) * 100 : 0,
        shareOfIncomePct: totalIncome > 0 ? (data.total / totalIncome) * 100 : 0,
        transactionCount: data.count,
        trendPct,
        color: meta.color,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);

  // Build Category Cap Statuses comparing baseline category averages vs user-defined monthly caps
  const categoryCapStatuses: CategoryCapStatus[] = SPENDING_CATEGORY_IDS.map((categoryId) => {
    const meta = CATEGORIES[categoryId];
    const data = catTotals.get(categoryId);
    const { monthsObserved, monthlyAverage } = computeCategoryBaselineStats(categoryId);
    const latestMonthActual = roundPence(data ? data.latestMonth : 0);
    const rawCap = categoryCaps[categoryId];
    const monthlyCap = typeof rawCap === 'number' && rawCap > 0 ? roundPence(rawCap) : null;

    if (monthlyCap === null) {
      return {
        categoryId,
        label: meta.label,
        spendingClass: meta.defaultClass,
        monthlyAverage,
        monthsObserved,
        latestMonthActual,
        monthlyCap: null,
        variance: 0,
        utilizationPct: 0,
        status: 'unset' as const,
      };
    }

    const variance = roundPence(monthlyAverage - monthlyCap);
    const utilizationPct = roundPence((monthlyAverage / monthlyCap) * 100);
    const status: CategoryCapStatus['status'] =
      monthlyAverage > monthlyCap ? 'over' : utilizationPct >= 85 ? 'near' : 'under';

    return {
      categoryId,
      label: meta.label,
      spendingClass: meta.defaultClass,
      monthlyAverage,
      monthsObserved,
      latestMonthActual,
      monthlyCap,
      variance,
      utilizationPct,
      status,
    };
  })
    .filter((item) => item.monthlyAverage > 0 || item.monthlyCap !== null)
    .sort((a, b) => {
      // Show capped categories first sorted by highest utilization %, then uncapped by spend
      if (a.monthlyCap !== null && b.monthlyCap === null) return -1;
      if (a.monthlyCap === null && b.monthlyCap !== null) return 1;
      if (a.monthlyCap !== null && b.monthlyCap !== null) {
        return b.utilizationPct - a.utilizationPct;
      }
      return b.monthlyAverage - a.monthlyAverage;
    });

  const totalOverCapMonthly = roundPence(
    categoryCapStatuses.reduce(
      (sum, c) => (c.monthlyCap !== null && c.variance > 0 ? sum + c.variance : sum),
      0
    )
  );

  // Build recurring & merchant drains
  const recurringItems: RecurringItem[] = [];
  const merchantDrains: MerchantDrain[] = [];

  for (const [mKey, data] of merchMap.entries()) {
    const distinctMonths = data.months.size;
    const monthTotals = Array.from(data.months.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, arr]) => arr.reduce((s, v) => s + v, 0));

    // Recurring heuristic: appears in >= 55% of months (min 3 months) and mostly 1 charge/month
    const avgTxPerActiveMonth = data.count / Math.max(distinctMonths, 1);
    const isSubscriptionLike =
      distinctMonths >= Math.min(3, monthCount) &&
      distinctMonths / monthCount >= 0.55 &&
      avgTxPerActiveMonth <= 1.35 &&
      data.categoryId !== 'groceries' &&
      data.categoryId !== 'dining_takeaway' &&
      data.categoryId !== 'coffee_convenience' &&
      data.categoryId !== 'shopping_retail';

    let priceHikeDetected: MerchantDrain['priceHikeDetected'];
    if (monthTotals.length >= 4) {
      const earlyAvg = (monthTotals[0] + monthTotals[1]) / 2;
      const lateAvg = (monthTotals[monthTotals.length - 1] + monthTotals[monthTotals.length - 2]) / 2;
      if (earlyAvg > 5 && lateAvg > earlyAvg * 1.1) {
        priceHikeDetected = {
          from: Math.round(earlyAvg * 100) / 100,
          to: Math.round(lateAvg * 100) / 100,
          pctIncrease: Math.round(((lateAvg - earlyAvg) / earlyAvg) * 100),
        };
      }
    }

    const catMeta = CATEGORIES[data.categoryId];

    merchantDrains.push({
      merchant: data.merchant,
      categoryId: data.categoryId,
      categoryLabel: catMeta.label,
      spendingClass: data.spendingClass,
      totalAmount: roundPence(data.total),
      monthlyAverage:
        data.baselineTotal > 0
          ? roundPence(data.baselineTotal / baselineMonthCount)
          : roundPence(data.total),
      transactionCount: data.count,
      avgTicket: roundPence(data.total / data.count),
      isRecurring: isSubscriptionLike,
      priceHikeDetected,
    });

    if (isSubscriptionLike && data.categoryId !== 'housing') {
      const recId = `rec-${mKey}`;
      const latestMonthly = Math.round((monthTotals[monthTotals.length - 1] ?? data.total / distinctMonths) * 100) / 100;
      const explicitAction = recurringActions[recId];
      const defaultSubClass: SubscriptionClass =
        data.spendingClass === 'essential' ? 'essential' : 'cancelable';
      const subscriptionClass: SubscriptionClass =
        subscriptionClassOverrides[recId] ??
        (explicitAction === 'cancel' ? 'cancelable' : defaultSubClass);

      // Reconcile action & Essential/Cancelable classification cleanly:
      // - If explicitly set to 'downgrade', keep 'downgrade' (35% savings).
      // - If marked 'cancelable', default action is 'cancel' (100% savings) unless user kept it in Cut & Save.
      // - If marked 'essential', default action is 'keep' (0% savings) unless negotiated (-35%).
      let action: 'keep' | 'downgrade' | 'cancel' = explicitAction ?? (subscriptionClass === 'cancelable' ? 'cancel' : 'keep');
      if (subscriptionClass === 'essential' && action === 'cancel') {
        action = 'keep';
      }
      if (subscriptionClass === 'cancelable' && !explicitAction) {
        action = 'cancel';
      }

      const potentialMonthlySaving =
        action === 'cancel'
          ? latestMonthly
          : action === 'downgrade'
            ? Math.round(latestMonthly * 0.35 * 100) / 100
            : 0;

      recurringItems.push({
        id: recId,
        merchant: data.merchant,
        categoryId: data.categoryId,
        categoryLabel: catMeta.label,
        spendingClass: data.spendingClass,
        subscriptionClass,
        monthlyCost: latestMonthly,
        annualCost: Math.round(latestMonthly * 12 * 100) / 100,
        occurrences: data.count,
        lastDate: data.lastDate,
        cadence: 'Monthly',
        priceIncreasePct: priceHikeDetected?.pctIncrease,
        action,
        potentialMonthlySaving,
      });
    }
  }

  merchantDrains.sort((a, b) => b.totalAmount - a.totalAmount);
  recurringItems.sort((a, b) => b.monthlyCost - a.monthlyCost);

  const essentialRecurringMonthly = recurringItems
    .filter((r) => r.subscriptionClass === 'essential')
    .reduce((sum, r) => sum + r.monthlyCost, 0);

  const cancelableRecurringMonthly = recurringItems
    .filter((r) => r.subscriptionClass === 'cancelable')
    .reduce((sum, r) => sum + r.monthlyCost, 0);

  // Calculate recurring savings from user classification & actions
  const unlockedMonthlyFromRecurring = recurringItems.reduce(
    (sum, item) => sum + item.potentialMonthlySaving,
    0
  );

  // Generate automated personalized recommendations from actual category spend
  const recommendations: SavingsRecommendation[] = [];
  const catById = new Map(categoryDrains.map((c) => [c.categoryId, c]));

  const takeawayCat = catById.get('dining_takeaway');
  if (takeawayCat && takeawayCat.monthlyAverage >= 80) {
    const id = 'cut-dining';
    const override = recommendationOverrides[id];
    const suggested = 45;
    recommendations.push({
      id,
      title: 'Halve takeaway & delivery orders',
      rationale: `You averaged ${Math.round(takeawayCat.monthlyAverage)}/mo across ${takeawayCat.transactionCount} dining & delivery charges${takeawayCat.trendPct > 5 ? ` (up ${Math.round(takeawayCat.trendPct)}% in the last 3 months)` : ''}. Cooking two extra evenings a week unlocks immediate monthly cash.`,
      categoryId: 'dining_takeaway',
      currentMonthly: takeawayCat.monthlyAverage,
      suggestedCutPct: suggested,
      activeCutPct: override?.activeCutPct ?? suggested,
      enabled: override?.enabled ?? true,
      effort: 'Low effort',
    });
  }

  const coffeeCat = catById.get('coffee_convenience');
  if (coffeeCat && coffeeCat.monthlyAverage >= 35) {
    const id = 'cut-coffee';
    const override = recommendationOverrides[id];
    const suggested = 55;
    recommendations.push({
      id,
      title: 'Trim weekday cafe & convenience stops',
      rationale: `${coffeeCat.transactionCount} small-ticket stops added up to ${Math.round(coffeeCat.totalAmount)} over ${monthCount} months. Replacing half with home coffee and packed lunches keeps your routine while capping impulse leaks.`,
      categoryId: 'coffee_convenience',
      currentMonthly: coffeeCat.monthlyAverage,
      suggestedCutPct: suggested,
      activeCutPct: override?.activeCutPct ?? suggested,
      enabled: override?.enabled ?? true,
      effort: 'Low effort',
    });
  }

  const retailCat = catById.get('shopping_retail');
  if (retailCat && retailCat.monthlyAverage >= 70) {
    const id = 'cut-retail';
    const override = recommendationOverrides[id];
    const suggested = 35;
    recommendations.push({
      id,
      title: 'Apply a 48-hour pause on online retail',
      rationale: `Online shopping and apparel averaged ${Math.round(retailCat.monthlyAverage)}/mo (${retailCat.shareOfIncomePct.toFixed(1)}% of net income). Waiting 48 hours before checkout typically eliminates 30–40% of discretionary orders.`,
      categoryId: 'shopping_retail',
      currentMonthly: retailCat.monthlyAverage,
      suggestedCutPct: suggested,
      activeCutPct: override?.activeCutPct ?? suggested,
      enabled: override?.enabled ?? true,
      effort: 'Moderate',
    });
  }

  const leisureCat = catById.get('entertainment_leisure');
  if (leisureCat && leisureCat.monthlyAverage >= 50) {
    const id = 'cut-leisure';
    const override = recommendationOverrides[id];
    const suggested = 25;
    recommendations.push({
      id,
      title: 'Set a monthly entertainment cap',
      rationale: `Social and leisure spending averaged ${Math.round(leisureCat.monthlyAverage)}/mo. Setting a dedicated fun-money envelope preserves weekends out while trimming 25% of overspend.`,
      categoryId: 'entertainment_leisure',
      currentMonthly: leisureCat.monthlyAverage,
      suggestedCutPct: suggested,
      activeCutPct: override?.activeCutPct ?? suggested,
      enabled: override?.enabled ?? false,
      effort: 'Moderate',
    });
  }

  const groceryCat = catById.get('groceries');
  if (groceryCat && groceryCat.monthlyAverage >= 220) {
    const id = 'cut-groceries';
    const override = recommendationOverrides[id];
    const suggested = 12;
    recommendations.push({
      id,
      title: 'Shift 1 weekly shop to a value grocer',
      rationale: `Groceries are essential (${Math.round(groceryCat.monthlyAverage)}/mo), yet moving staple items from premium supermarkets to discount grocers typically trims 10–15% without reducing meal quality.`,
      categoryId: 'groceries',
      currentMonthly: groceryCat.monthlyAverage,
      suggestedCutPct: suggested,
      activeCutPct: override?.activeCutPct ?? suggested,
      enabled: override?.enabled ?? false,
      effort: 'Low effort',
    });
  }

  const unlockedMonthlyFromCuts = recommendations.reduce((sum, rec) => {
    if (!rec.enabled) return sum;
    return sum + rec.currentMonthly * (rec.activeCutPct / 100);
  }, 0);

  const totalRecommendedMonthlySavings = unlockedMonthlyFromCuts + unlockedMonthlyFromRecurring;

  const dateRangeLabel =
    activeMonthKeys.length > 0
      ? `${formatMonthLabel(activeMonthKeys[0])} – ${formatMonthLabel(activeMonthKeys[activeMonthKeys.length - 1])}`
      : 'No dates';

  return {
    monthCount,
    baselineMonthCount,
    excludedPartialMonth,
    excludedPartialMonthLabel,
    dateRangeLabel,
    monthlySeries,
    totalIncome,
    totalSpending,
    totalEssential,
    totalNonEssential,
    totalSavingsTransferred,
    avgMonthlyIncome,
    avgMonthlySpending,
    avgMonthlyEssential,
    avgMonthlyNonEssential,
    avgMonthlySavingsTransfer,
    avgMonthlySurplus,
    essentialSharePct,
    nonEssentialSharePct,
    savingsRatePct,
    categoryDrains,
    categoryCapStatuses,
    totalOverCapMonthly,
    merchantDrains,
    recurringItems,
    essentialRecurringMonthly,
    cancelableRecurringMonthly,
    recommendations,
    unlockedMonthlyFromCuts,
    unlockedMonthlyFromRecurring,
    totalRecommendedMonthlySavings,
    currencyBreakdown,
    upcomingBills: computeUpcomingBills(
      transactions,
      displayCurrency,
      exchangeRates,
      7,
      projectionOptions?.referenceDate ?? new Date(),
      recurringActions,
      subscriptionClassOverrides
    ),
    spendingTrendProjection: computeCategoryVarianceProjections(
      filteredTx,
      categoryCaps,
      displayCurrency,
      exchangeRates,
      projectionOptions
    ),
  };
}

const MS_PER_DAY = 86_400_000;

function toLocalMidnightMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addMonthsClamped(year: number, monthIndex0: number, targetDay: number): Date {
  const normalized = new Date(year, monthIndex0, 1);
  const lastDay = new Date(normalized.getFullYear(), normalized.getMonth() + 1, 0).getDate();
  return new Date(
    normalized.getFullYear(),
    normalized.getMonth(),
    Math.min(Math.max(1, targetDay), lastDay)
  );
}

const CORE_BILL_CATEGORIES = new Set<CategoryId>([
  'housing',
  'utilities',
  'insurance_health',
  'subscriptions',
]);

const NON_BILL_VARIABLE_CATEGORIES = new Set<CategoryId>([
  'groceries',
  'dining_takeaway',
  'coffee_convenience',
  'shopping_retail',
  'entertainment_leisure',
  'travel_holidays',
]);

/**
 * Predicts recurring bills due within the next `windowDays` (default 7) based on
 * historical recurring patterns in the transaction ledger.
 */
export function computeUpcomingBills(
  transactions: Transaction[],
  displayCurrency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>,
  windowDays = 7,
  referenceDate: Date = new Date(),
  recurringActions: Record<string, 'keep' | 'downgrade' | 'cancel'> = {},
  subscriptionClassOverrides: Record<string, SubscriptionClass> = {}
): UpcomingBillsSummary {
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const todayMs = today.getTime();
  const todayStr = formatYmd(today);
  const windowEnd = new Date(todayMs + windowDays * MS_PER_DAY);
  const windowEndStr = formatYmd(windowEnd);

  if (transactions.length === 0) {
    return {
      windowDays,
      referenceDate: todayStr,
      windowEndDate: windowEndStr,
      dueSoon: [],
      nextAfterWindow: null,
      totalDueSoon: 0,
      essentialDueSoon: 0,
      nonEssentialDueSoon: 0,
      cancelableDueSoon: 0,
    };
  }

  // Latest recorded date in the ledger so we only project currently active recurring bills
  let latestLedgerMs = 0;
  for (const tx of transactions) {
    const ms = toLocalMidnightMs(tx.date);
    if (ms > latestLedgerMs) latestLedgerMs = ms;
  }

  const byMerchant = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (
      tx.amount >= 0 ||
      tx.spendingClass === 'income' ||
      tx.spendingClass === 'savings'
    ) {
      continue;
    }
    const key = tx.merchant.trim().toLowerCase();
    if (!key) continue;
    const list = byMerchant.get(key) ?? [];
    list.push(tx);
    byMerchant.set(key, list);
  }

  const allUpcoming: UpcomingBill[] = [];

  for (const [mKey, txs] of byMerchant.entries()) {
    if (txs.length < 2) continue;
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const latestTx = sorted[sorted.length - 1];
    const hasExplicitRecurring = sorted.some((t) => Boolean(t.isRecurring));

    // Skip chaotic day-to-day discretionary spend unless explicitly recurring or fixed-price
    const convertedAmounts = sorted.map((t) =>
      Math.abs(getTransactionDisplayAmount(t, displayCurrency, exchangeRates))
    );
    const avgAmt =
      convertedAmounts.reduce((s, a) => s + a, 0) / Math.max(convertedAmounts.length, 1);
    const maxRelDev = convertedAmounts.reduce(
      (max, a) => Math.max(max, avgAmt > 0 ? Math.abs(a - avgAmt) / avgAmt : 0),
      0
    );

    if (
      NON_BILL_VARIABLE_CATEGORIES.has(latestTx.category) &&
      !hasExplicitRecurring &&
      maxRelDev > 0.12
    ) {
      continue;
    }

    // Deduplicate same-day dates and compute inter-charge day gaps
    const uniqueDates = Array.from(new Set(sorted.map((t) => t.date))).sort();
    if (uniqueDates.length < 2) continue;

    const gaps: number[] = [];
    for (let i = 1; i < uniqueDates.length; i++) {
      const diff = Math.round(
        (toLocalMidnightMs(uniqueDates[i]) - toLocalMidnightMs(uniqueDates[i - 1])) /
          MS_PER_DAY
      );
      if (diff > 0) gaps.push(diff);
    }
    if (gaps.length === 0) continue;

    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const distinctMonths = new Set(uniqueDates.map((d) => d.slice(0, 7))).size;
    const avgPerActiveMonth = sorted.length / Math.max(distinctMonths, 1);

    let cadence: UpcomingBill['cadence'] | null = null;
    if (medianGap >= 6 && medianGap <= 8 && uniqueDates.length >= 3 && (hasExplicitRecurring || maxRelDev <= 0.18)) {
      cadence = 'Weekly';
    } else if (
      medianGap >= 13 &&
      medianGap <= 15 &&
      uniqueDates.length >= 3 &&
      (hasExplicitRecurring || maxRelDev <= 0.18)
    ) {
      cadence = 'Bi-weekly';
    } else if (
      medianGap >= 25 &&
      medianGap <= 36 &&
      distinctMonths >= 2 &&
      avgPerActiveMonth <= 1.35 &&
      (CORE_BILL_CATEGORIES.has(latestTx.category) || hasExplicitRecurring || maxRelDev <= 0.25)
    ) {
      cadence = 'Monthly';
    } else if (
      medianGap >= 80 &&
      medianGap <= 105 &&
      uniqueDates.length >= 2 &&
      (CORE_BILL_CATEGORIES.has(latestTx.category) || hasExplicitRecurring || maxRelDev <= 0.25)
    ) {
      cadence = 'Quarterly';
    }

    if (!cadence) continue;

    // Ensure the bill is still active near the end of the user's ledger (not an old cancelled subscription)
    const lastPaidMs = toLocalMidnightMs(latestTx.date);
    const maxStalenessDays =
      cadence === 'Quarterly' ? 115 : cadence === 'Monthly' ? 62 : cadence === 'Bi-weekly' ? 28 : 16;
    if (latestLedgerMs - lastPaidMs > maxStalenessDays * MS_PER_DAY) {
      continue;
    }

    // Calculate next expected due date >= today
    let nextDueDate: Date;
    let typicalDayOfMonth: number | undefined;

    if (cadence === 'Monthly') {
      const days = uniqueDates.map((d) => parseInt(d.slice(8, 10), 10)).sort((a, b) => a - b);
      typicalDayOfMonth = days[Math.floor(days.length / 2)];

      let candidate = addMonthsClamped(today.getFullYear(), today.getMonth(), typicalDayOfMonth);
      // If candidate is in the past, or this merchant already posted on/near this billing cycle today, advance 1 month
      const latestMonthKey = latestTx.date.slice(0, 7);
      const todayMonthKey = todayStr.slice(0, 7);
      const alreadyPaidThisMonth =
        latestMonthKey === todayMonthKey && latestTx.date <= todayStr;

      if (candidate.getTime() < todayMs || (alreadyPaidThisMonth && candidate.getTime() <= lastPaidMs + 5 * MS_PER_DAY)) {
        candidate = addMonthsClamped(
          today.getFullYear(),
          today.getMonth() + 1,
          typicalDayOfMonth
        );
      }
      nextDueDate = candidate;
    } else if (cadence === 'Quarterly') {
      const [ly, lm, ld] = latestTx.date.split('-').map((n) => parseInt(n, 10));
      typicalDayOfMonth = ld;
      let step = 1;
      let candidate = addMonthsClamped(ly, lm - 1 + step * 3, ld);
      while (candidate.getTime() < todayMs && step < 40) {
        step++;
        candidate = addMonthsClamped(ly, lm - 1 + step * 3, ld);
      }
      nextDueDate = candidate;
    } else {
      const stepDays = cadence === 'Weekly' ? 7 : 14;
      let candidateMs = lastPaidMs + stepDays * MS_PER_DAY;
      while (candidateMs < todayMs) {
        candidateMs += stepDays * MS_PER_DAY;
      }
      nextDueDate = new Date(candidateMs);
    }

    const daysUntilDue = Math.round((nextDueDate.getTime() - todayMs) / MS_PER_DAY);
    if (daysUntilDue < 0) continue;

    const nativeCurrency: CurrencyCode = latestTx.currency ?? displayCurrency;
    const nativeAmount = Math.abs(latestTx.amount);
    const expectedAmount = Math.round(
      Math.abs(getTransactionDisplayAmount(latestTx, displayCurrency, exchangeRates)) * 100
    ) / 100;

    const recId = `rec-${mKey}`;
    const explicitAction = recurringActions[recId];
    const subOverride = subscriptionClassOverrides[recId];
    const markedForCancel =
      explicitAction === 'cancel' ||
      (subOverride === 'cancelable' && explicitAction !== 'keep');

    allUpcoming.push({
      id: `upcoming-${mKey}`,
      merchant: latestTx.merchant,
      categoryId: latestTx.category,
      categoryLabel: CATEGORIES[latestTx.category]?.label ?? latestTx.category,
      spendingClass: latestTx.spendingClass,
      cadence,
      dueDate: formatYmd(nextDueDate),
      daysUntilDue,
      expectedAmount,
      nativeAmount,
      nativeCurrency,
      occurrences: sorted.length,
      typicalDayOfMonth,
      lastPaidDate: latestTx.date,
      markedForCancel,
    });
  }

  allUpcoming.sort((a, b) => {
    if (a.daysUntilDue !== b.daysUntilDue) return a.daysUntilDue - b.daysUntilDue;
    return b.expectedAmount - a.expectedAmount;
  });

  const dueSoon = allUpcoming.filter((b) => b.daysUntilDue <= windowDays);
  const nextAfterWindow = allUpcoming.find((b) => b.daysUntilDue > windowDays) ?? null;

  const totalDueSoon = dueSoon.reduce((sum, b) => sum + b.expectedAmount, 0);
  const essentialDueSoon = dueSoon
    .filter((b) => b.spendingClass === 'essential')
    .reduce((sum, b) => sum + b.expectedAmount, 0);
  const nonEssentialDueSoon = dueSoon
    .filter((b) => b.spendingClass !== 'essential')
    .reduce((sum, b) => sum + b.expectedAmount, 0);
  const cancelableDueSoon = dueSoon
    .filter((b) => b.markedForCancel)
    .reduce((sum, b) => sum + b.expectedAmount, 0);

  return {
    windowDays,
    referenceDate: todayStr,
    windowEndDate: windowEndStr,
    dueSoon,
    nextAfterWindow,
    totalDueSoon,
    essentialDueSoon,
    nonEssentialDueSoon,
    cancelableDueSoon,
  };
}

export interface ProjectionPoint {
  year: number;
  label: string;
  contributions: number;
  currentAccount: number;
  cashIsa: number;
  blendedIsa: number;
  taxSavedVsTaxable: number;
}

export interface IsaProjectionSummary {
  points: ProjectionPoint[];
  finalContributions: number;
  finalCurrentAccount: number;
  finalCashIsa: number;
  finalBlendedIsa: number;
  cashIsaInterestEarned: number;
  lisaGovtBonusTotal: number;
  taxSavedTotal: number;
  annualIsaContribution: number;
  annualLisaContribution: number;
  isaAllowanceUsedPct: number;
  lisaAllowanceUsedPct: number;
}

export function computeWealthProjections(
  monthlyContribution: number,
  settings: IsaPlannerSettings
): IsaProjectionSummary {
  const years = settings.horizonYears;
  const taxRate =
    settings.taxBand === 'additional_45' ? 0.45 : settings.taxBand === 'higher_40' ? 0.4 : 0.2;
  const personalSavingsAllowance =
    settings.taxBand === 'additional_45' ? 0 : settings.taxBand === 'higher_40' ? 500 : 1000;

  const rCurrent = settings.currentAccountRate / 100 / 12;
  const rCashIsa = settings.cashIsaRate / 100 / 12;
  const rLisa = settings.lisaRate / 100 / 12;
  const rStocks = settings.stocksIsaRate / 100 / 12;

  const totalSplit = Math.max(
    settings.cashIsaSplitPct + settings.lisaSplitPct + settings.stocksIsaSplitPct,
    1
  );
  const wCash = settings.cashIsaSplitPct / totalSplit;
  const wLisa = settings.lisaSplitPct / totalSplit;
  const wStocks = settings.stocksIsaSplitPct / totalSplit;

  // Enforce UK LISA £4,000/yr cap (£333.33/mo) and spill excess into Cash ISA
  const rawMonthlyLisa = monthlyContribution * wLisa;
  const cappedMonthlyLisa = Math.min(rawMonthlyLisa, 4000 / 12);
  const lisaSpillover = rawMonthlyLisa - cappedMonthlyLisa;
  const monthlyCash = monthlyContribution * wCash + lisaSpillover;
  const monthlyStocks = monthlyContribution * wStocks;

  let contributions = 0;
  let currentAccBal = 0;
  let cashIsaOnlyBal = 0;
  let taxableSavingsBal = 0;

  let blendCashBal = 0;
  let blendLisaBal = 0;
  let blendStocksBal = 0;
  let lisaBonusAccum = 0;
  let taxSavedTotal = 0;

  const points: ProjectionPoint[] = [
    {
      year: 0,
      label: 'Now',
      contributions: 0,
      currentAccount: 0,
      cashIsa: 0,
      blendedIsa: 0,
      taxSavedVsTaxable: 0,
    },
  ];

  for (let y = 1; y <= years; y++) {
    let annualTaxableInterest = 0;
    for (let m = 0; m < 12; m++) {
      contributions += monthlyContribution;
      currentAccBal = (currentAccBal + monthlyContribution) * (1 + rCurrent);
      cashIsaOnlyBal = (cashIsaOnlyBal + monthlyContribution) * (1 + rCashIsa);

      const monthInterest = (taxableSavingsBal + monthlyContribution) * rCashIsa;
      annualTaxableInterest += monthInterest;
      taxableSavingsBal += monthlyContribution + monthInterest;

      blendCashBal = (blendCashBal + monthlyCash) * (1 + rCashIsa);
      const lisaBonus = cappedMonthlyLisa * 0.25;
      lisaBonusAccum += lisaBonus;
      blendLisaBal = (blendLisaBal + cappedMonthlyLisa + lisaBonus) * (1 + rLisa);
      blendStocksBal = (blendStocksBal + monthlyStocks) * (1 + rStocks);
    }

    // Apply UK personal savings allowance tax drag at year end for taxable benchmark
    const taxableExcess = Math.max(0, annualTaxableInterest - personalSavingsAllowance);
    const annualTaxDrag = taxableExcess * taxRate;
    taxableSavingsBal -= annualTaxDrag;
    taxSavedTotal += annualTaxDrag;

    points.push({
      year: y,
      label: `Yr ${y}`,
      contributions: Math.round(contributions),
      currentAccount: Math.round(currentAccBal),
      cashIsa: Math.round(cashIsaOnlyBal),
      blendedIsa: Math.round(blendCashBal + blendLisaBal + blendStocksBal),
      taxSavedVsTaxable: Math.round(taxSavedTotal),
    });
  }

  const last = points[points.length - 1];
  const annualContribution = monthlyContribution * 12;
  const annualLisaContribution = cappedMonthlyLisa * 12;

  return {
    points,
    finalContributions: last.contributions,
    finalCurrentAccount: last.currentAccount,
    finalCashIsa: last.cashIsa,
    finalBlendedIsa: last.blendedIsa,
    cashIsaInterestEarned: Math.max(0, last.cashIsa - last.contributions),
    lisaGovtBonusTotal: Math.round(lisaBonusAccum),
    taxSavedTotal: Math.round(taxSavedTotal),
    annualIsaContribution: Math.round(annualContribution),
    annualLisaContribution: Math.round(annualLisaContribution),
    isaAllowanceUsedPct: Math.min(100, (annualContribution / 20000) * 100),
    lisaAllowanceUsedPct: Math.min(100, (annualLisaContribution / 4000) * 100),
  };
}

export function estimateGoalMonths(
  goal: SavingsGoal,
  totalMonthlyPot: number,
  settings: IsaPlannerSettings
): { months: number | null; monthlyAllocated: number; targetDateLabel: string } {
  const remaining = Math.max(0, goal.targetAmount - goal.currentSaved);
  if (remaining === 0) {
    return { months: 0, monthlyAllocated: 0, targetDateLabel: 'Reached' };
  }

  const monthlyAllocated = (totalMonthlyPot * goal.monthlyAllocationPct) / 100;
  if (monthlyAllocated <= 0) {
    return { months: null, monthlyAllocated: 0, targetDateLabel: 'Add monthly savings' };
  }

  const annualRate =
    goal.vehicle === 'stocks_isa'
      ? settings.stocksIsaRate
      : goal.vehicle === 'lifetime_isa'
        ? settings.lisaRate
        : goal.vehicle === 'cash_isa'
          ? settings.cashIsaRate
          : Math.max(settings.cashIsaRate - 0.35, 3.5);

  const monthlyRate = annualRate / 100 / 12;
  const effectiveMonthly =
    goal.vehicle === 'lifetime_isa'
      ? monthlyAllocated + Math.min(monthlyAllocated, 4000 / 12) * 0.25
      : monthlyAllocated;

  let bal = goal.currentSaved;
  let months = 0;
  while (bal < goal.targetAmount && months < 480) {
    bal = (bal + effectiveMonthly) * (1 + monthlyRate);
    months++;
  }

  const targetDate = new Date();
  targetDate.setMonth(targetDate.getMonth() + months);
  const targetDateLabel = `${MONTH_NAMES[targetDate.getMonth()]} ${targetDate.getFullYear()}`;

  return { months, monthlyAllocated, targetDateLabel };
}

/**
 * Local background projection check:
 * Evaluates current/latest statement month spending pace per capped category
 * and flags any category projected to exceed its custom monthly cap before month-end.
 */
export function computeProjectedCapAlerts(
  transactions: Transaction[],
  categoryCaps: Partial<Record<CategoryId, number>> = {},
  referenceDate: Date = new Date(),
  displayCurrency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>
): CapPaceAlert[] {
  if (transactions.length === 0) return [];

  const cappedEntries = Object.entries(categoryCaps).filter(
    ([, cap]) => typeof cap === 'number' && cap > 0
  ) as Array<[CategoryId, number]>;
  if (cappedEntries.length === 0) return [];

  // Identify the most recent month present in the user's statements
  const latestMonthKey = transactions.reduce(
    (max, tx) => (tx.date.slice(0, 7) > max ? tx.date.slice(0, 7) : max),
    ''
  );
  if (!latestMonthKey) return [];

  const [yearStr, monthStr] = latestMonthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();

  const refMonthKey = `${referenceDate.getFullYear()}-${String(
    referenceDate.getMonth() + 1
  ).padStart(2, '0')}`;

  const monthTxs = transactions.filter(
    (tx) =>
      tx.date.startsWith(latestMonthKey) &&
      tx.spendingClass !== 'income' &&
      tx.spendingClass !== 'savings' &&
      tx.amount < 0
  );

  if (monthTxs.length === 0) return [];

  const maxTxDay = monthTxs.reduce((maxD, tx) => {
    const d = parseInt(tx.date.slice(8, 10), 10);
    return Number.isFinite(d) && d > maxD ? d : maxD;
  }, 1);

  // If latest month is the active calendar month, pace against current day of month
  // (or latest recorded day, whichever gives the realistic elapsed fraction)
  const elapsedDays =
    latestMonthKey === refMonthKey
      ? Math.max(1, Math.min(daysInMonth, referenceDate.getDate()))
      : Math.max(1, Math.min(daysInMonth, maxTxDay));

  const daysRemaining = Math.max(0, daysInMonth - elapsedDays);
  const paceMultiplier = daysInMonth / elapsedDays;

  const spentByCategory = new Map<CategoryId, number>();
  for (const tx of monthTxs) {
    // When in the active month, only include transactions up to the elapsed cutoff
    const txDay = parseInt(tx.date.slice(8, 10), 10);
    if (latestMonthKey === refMonthKey && txDay > elapsedDays) continue;
    const convertedAbs = Math.abs(
      getTransactionDisplayAmount(tx, displayCurrency, exchangeRates)
    );
    spentByCategory.set(
      tx.category,
      (spentByCategory.get(tx.category) ?? 0) + convertedAbs
    );
  }

  const alerts: CapPaceAlert[] = [];
  const monthLabel = formatMonthLabel(latestMonthKey);

  for (const [categoryId, rawMonthlyCap] of cappedEntries) {
    const spentToDate = roundPence(spentByCategory.get(categoryId) ?? 0);
    if (spentToDate <= 0) continue;

    const monthlyCap = roundPence(rawMonthlyCap);
    const projectedMonthEnd = roundPence(spentToDate * paceMultiplier);
    if (projectedMonthEnd > monthlyCap) {
      alerts.push({
        categoryId,
        label: CATEGORIES[categoryId]?.label ?? categoryId,
        monthKey: latestMonthKey,
        monthLabel,
        spentToDate,
        projectedMonthEnd,
        monthlyCap,
        projectedOverage: roundPence(projectedMonthEnd - monthlyCap),
        projectedPctOfCap: roundPence((projectedMonthEnd / monthlyCap) * 100),
        elapsedDays,
        daysInMonth,
        daysRemaining,
      });
    }
  }

  return alerts.sort((a, b) => b.projectedOverage - a.projectedOverage);
}

/**
 * Automated Rules Engine:
 * Learns merchant/keyword mappings from previously saved user labels and recurring
 * transaction patterns so newly imported or uncategorized rows receive accurate suggestions.
 */
function normalizeRulePattern(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9&\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildLearnedCategoryRules(
  existingTransactions: Transaction[],
  savedRules: CategoryRule[] = []
): CategoryRule[] {
  const byPattern = new Map<string, CategoryRule>();

  // 1. Seed with explicit user-saved rules (highest priority)
  for (const rule of savedRules) {
    const pat = normalizeRulePattern(rule.matchPattern);
    if (!pat) continue;
    byPattern.set(pat, {
      ...rule,
      matchPattern: pat,
    });
  }

  // 2. Learn from historical merchant consistency & recurring cadence across existing ledger
  const merchantGroups = new Map<
    string,
    {
      merchantRaw: string;
      counts: Map<CategoryId, { count: number; spendingClass: Transaction['spendingClass'] }>;
      months: Set<string>;
      amounts: number[];
      total: number;
    }
  >();

  for (const tx of existingTransactions) {
    const pat = normalizeRulePattern(tx.merchant);
    if (!pat || pat.length < 3) continue;
    const entry = merchantGroups.get(pat) ?? {
      merchantRaw: tx.merchant,
      counts: new Map<CategoryId, { count: number; spendingClass: Transaction['spendingClass'] }>(),
      months: new Set<string>(),
      amounts: [] as number[],
      total: 0,
    };
    const prev = entry.counts.get(tx.category) ?? {
      count: 0,
      spendingClass: tx.spendingClass,
    };
    prev.count += 1;
    prev.spendingClass = tx.spendingClass;
    entry.counts.set(tx.category, prev);
    entry.months.add(tx.date.slice(0, 7));
    entry.amounts.push(Math.abs(tx.amount));
    entry.total += 1;
    merchantGroups.set(pat, entry);
  }

  const nowIso = new Date().toISOString();

  for (const [pat, group] of merchantGroups.entries()) {
    if (byPattern.has(pat)) continue;

    // Find dominant category for this merchant
    let topCategory: CategoryId | null = null;
    let topCount = 0;
    let topClass: Transaction['spendingClass'] = 'non-essential';
    for (const [cat, info] of group.counts.entries()) {
      if (info.count > topCount) {
        topCount = info.count;
        topCategory = cat;
        topClass = info.spendingClass;
      }
    }

    if (!topCategory) continue;
    const consistency = topCount / Math.max(group.total, 1);

    // Check recurring amount regularity across >= 3 distinct months
    const avgAmt =
      group.amounts.reduce((s, a) => s + a, 0) / Math.max(group.amounts.length, 1);
    const maxDeviation = group.amounts.reduce(
      (max, a) => Math.max(max, avgAmt > 0 ? Math.abs(a - avgAmt) / avgAmt : 0),
      0
    );
    const isRecurringPattern =
      group.months.size >= 3 &&
      group.total / Math.max(group.months.size, 1) <= 1.35 &&
      maxDeviation <= 0.25;

    if (isRecurringPattern && topCategory === 'other_discretionary' && avgAmt <= 250) {
      byPattern.set(pat, {
        id: `auto-rec-${pat.replace(/\s+/g, '-')}`,
        matchPattern: pat,
        matchType: 'recurring_pattern',
        category: 'subscriptions',
        spendingClass: 'non-essential',
        source: 'recurring_pattern',
        confidence: 86,
        matchCount: group.total,
        updatedAt: nowIso,
      });
    } else if (
      topCategory !== 'other_discretionary' &&
      group.total >= 2 &&
      consistency >= 0.75
    ) {
      byPattern.set(pat, {
        id: `auto-lbl-${pat.replace(/\s+/g, '-')}`,
        matchPattern: pat,
        matchType: isRecurringPattern ? 'recurring_pattern' : 'exact_merchant',
        category: topCategory,
        spendingClass: topClass,
        source: isRecurringPattern ? 'recurring_pattern' : 'user_label',
        confidence: Math.min(98, Math.round(consistency * 100)),
        matchCount: topCount,
        updatedAt: nowIso,
      });
    }
  }

  return Array.from(byPattern.values()).sort((a, b) => {
    if (a.source === 'manual' && b.source !== 'manual') return -1;
    if (b.source === 'manual' && a.source !== 'manual') return 1;
    return b.matchCount - a.matchCount;
  });
}

export function describeAdvancedRuleCondition(
  rule: Pick<
    AdvancedAutomationRule,
    'merchantContains' | 'amountOperator' | 'amountValue' | 'amountMax' | 'currencyFilter'
  >,
  primaryCurrency: CurrencyCode = 'GBP'
): string {
  const parts: string[] = [];
  const query = rule.merchantContains.trim();
  if (query) {
    parts.push(`merchant contains "${query}"`);
  }
  const activeCurr: CurrencyCode =
    rule.currencyFilter && rule.currencyFilter !== 'any'
      ? rule.currencyFilter
      : primaryCurrency;

  if (rule.amountOperator !== 'any' && typeof rule.amountValue === 'number' && Number.isFinite(rule.amountValue)) {
    const formattedVal = formatMoney(rule.amountValue, activeCurr, 0);
    if (rule.amountOperator === 'gt') parts.push(`amount > ${formattedVal}`);
    else if (rule.amountOperator === 'gte') parts.push(`amount >= ${formattedVal}`);
    else if (rule.amountOperator === 'lt') parts.push(`amount < ${formattedVal}`);
    else if (rule.amountOperator === 'lte') parts.push(`amount <= ${formattedVal}`);
    else if (rule.amountOperator === 'between') {
      const formattedMax =
        typeof rule.amountMax === 'number' && Number.isFinite(rule.amountMax)
          ? formatMoney(rule.amountMax, activeCurr, 0)
          : formattedVal;
      parts.push(`amount ${formattedVal}–${formattedMax}`);
    }
  }
  if (rule.currencyFilter && rule.currencyFilter !== 'any') {
    parts.push(`currency is ${rule.currencyFilter}`);
  }
  return parts.length > 0 ? parts.join(' AND ') : 'All matching expenses';
}

export function matchesAdvancedRule(
  tx: Transaction,
  rule: AdvancedAutomationRule,
  primaryCurrency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>
): boolean {
  if (!rule.enabled) return false;

  // Sign guard: don't match positive inflows unless the rule explicitly targets income
  if (tx.amount > 0 && rule.targetSpendingClass !== 'income') {
    return false;
  }

  const txCurrency: CurrencyCode = tx.currency ?? primaryCurrency;
  if (rule.currencyFilter && rule.currencyFilter !== 'any' && txCurrency !== rule.currencyFilter) {
    return false;
  }

  const needle = rule.merchantContains.trim().toLowerCase();
  if (needle) {
    const hay = `${tx.merchant} ${tx.description}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }

  if (rule.amountOperator !== 'any') {
    const threshold = rule.amountValue;
    if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
      return false;
    }
    // Compare in native currency if rule filters a specific currency, else in primary display currency
    const absAmt =
      rule.currencyFilter && rule.currencyFilter !== 'any'
        ? Math.abs(tx.amount)
        : Math.abs(getTransactionDisplayAmount(tx, primaryCurrency, exchangeRates));

    if (rule.amountOperator === 'gt' && !(absAmt > threshold)) return false;
    if (rule.amountOperator === 'gte' && !(absAmt >= threshold)) return false;
    if (rule.amountOperator === 'lt' && !(absAmt < threshold)) return false;
    if (rule.amountOperator === 'lte' && !(absAmt <= threshold)) return false;
    if (rule.amountOperator === 'between') {
      const upper =
        typeof rule.amountMax === 'number' && Number.isFinite(rule.amountMax)
          ? rule.amountMax
          : threshold;
      const lo = Math.min(threshold, upper);
      const hi = Math.max(threshold, upper);
      if (absAmt < lo || absAmt > hi) return false;
    }
  }

  return true;
}

export function evaluateAdvancedRules(
  transactions: Transaction[],
  advancedRules: AdvancedAutomationRule[],
  primaryCurrency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>
): CategoryRuleSuggestion[] {
  const enabledRules = advancedRules.filter((r) => r.enabled);
  if (enabledRules.length === 0 || transactions.length === 0) return [];

  const suggestions: CategoryRuleSuggestion[] = [];

  for (const tx of transactions) {
    for (const rule of enabledRules) {
      if (!matchesAdvancedRule(tx, rule, primaryCurrency, exchangeRates)) continue;

      const suggestedCategory = rule.targetCategory ?? tx.category;
      const suggestedClass = rule.targetSpendingClass;

      if (tx.category !== suggestedCategory || tx.spendingClass !== suggestedClass) {
        const condSummary = describeAdvancedRuleCondition(rule, primaryCurrency);
        suggestions.push({
          transactionId: tx.id,
          merchant: tx.merchant,
          description: tx.description,
          date: tx.date,
          amount: tx.amount,
          currentCategory: tx.category,
          suggestedCategory,
          suggestedClass,
          reason: `Advanced rule "${rule.name || condSummary}" (${condSummary})`,
          ruleSource: 'manual',
          confidence: 100,
          matchPattern: rule.merchantContains.trim().toLowerCase() || rule.name,
        });
      }
      // First matching enabled advanced rule wins for this transaction
      break;
    }
  }

  return suggestions;
}

export function suggestCategoryMappings(
  targetTransactions: Transaction[],
  existingTransactions: Transaction[],
  savedRules: CategoryRule[] = [],
  advancedRules: AdvancedAutomationRule[] = [],
  primaryCurrency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>
): CategoryRuleSuggestion[] {
  if (targetTransactions.length === 0) return [];

  const rules = buildLearnedCategoryRules(
    existingTransactions.length > 0 ? existingTransactions : targetTransactions,
    savedRules
  );

  // Evaluate conditional Advanced Rules first (highest priority)
  const enabledAdvancedRules = advancedRules.filter((r) => r.enabled);

  // Also detect recurring patterns directly inside the incoming batch itself
  const batchMerchantMonths = new Map<string, { months: Set<string>; amounts: number[] }>();
  for (const tx of targetTransactions) {
    if (tx.amount >= 0) continue;
    const pat = normalizeRulePattern(tx.merchant);
    if (!pat) continue;
    const rec = batchMerchantMonths.get(pat) ?? {
      months: new Set<string>(),
      amounts: [] as number[],
    };
    rec.months.add(tx.date.slice(0, 7));
    rec.amounts.push(
      Math.abs(getTransactionDisplayAmount(tx, primaryCurrency, exchangeRates))
    );
    batchMerchantMonths.set(pat, rec);
  }

  const suggestions: CategoryRuleSuggestion[] = [];

  for (const tx of targetTransactions) {
    // 1. Check conditional Advanced Rules first
    let handledByAdvancedRule = false;
    for (const advRule of enabledAdvancedRules) {
      if (!matchesAdvancedRule(tx, advRule, primaryCurrency, exchangeRates)) continue;
      handledByAdvancedRule = true;
      const suggestedCategory = advRule.targetCategory ?? tx.category;
      const suggestedClass = advRule.targetSpendingClass;
      if (tx.category !== suggestedCategory || tx.spendingClass !== suggestedClass) {
        const condSummary = describeAdvancedRuleCondition(advRule, primaryCurrency);
        suggestions.push({
          transactionId: tx.id,
          merchant: tx.merchant,
          description: tx.description,
          date: tx.date,
          amount: tx.amount,
          currentCategory: tx.category,
          suggestedCategory,
          suggestedClass,
          reason: `Advanced rule "${advRule.name || condSummary}" (${condSummary})`,
          ruleSource: 'manual',
          confidence: 100,
          matchPattern: advRule.merchantContains.trim().toLowerCase() || advRule.name,
        });
      }
      break;
    }
    if (handledByAdvancedRule) continue;

    // 2. Fall back to merchant-level saved / learned rules
    const normMerchant = normalizeRulePattern(tx.merchant);
    const normDesc = normalizeRulePattern(tx.description);

    let matchedRule: CategoryRule | null = null;
    for (const rule of rules) {
      if (rule.matchType === 'contains_keyword') {
        if (normMerchant.includes(rule.matchPattern) || normDesc.includes(rule.matchPattern)) {
          matchedRule = rule;
          break;
        }
      } else if (
        normMerchant === rule.matchPattern ||
        normDesc.includes(rule.matchPattern)
      ) {
        matchedRule = rule;
        break;
      }
    }

    if (matchedRule) {
      // Respect sign guard: don't map positive inflows to expense categories
      if (tx.amount > 0 && matchedRule.spendingClass !== 'income') {
        continue;
      }
      if (
        tx.category !== matchedRule.category ||
        tx.spendingClass !== matchedRule.spendingClass
      ) {
        const reason =
          matchedRule.source === 'manual'
            ? `Matches your saved label rule for "${matchedRule.matchPattern}"`
            : matchedRule.source === 'recurring_pattern'
              ? `Matches recurring pattern (${matchedRule.matchCount} historical charges)`
              : `Matches ${matchedRule.matchCount} previously labeled "${matchedRule.matchPattern}" transactions`;

        suggestions.push({
          transactionId: tx.id,
          merchant: tx.merchant,
          description: tx.description,
          date: tx.date,
          amount: tx.amount,
          currentCategory: tx.category,
          suggestedCategory: matchedRule.category,
          suggestedClass: matchedRule.spendingClass,
          reason,
          ruleSource: matchedRule.source,
          confidence: matchedRule.confidence,
          matchPattern: matchedRule.matchPattern,
        });
      }
      continue;
    }

    // 3. Fallback: detect brand-new recurring subscription patterns inside uncategorized imports
    if (tx.amount < 0 && tx.category === 'other_discretionary') {
      const batchStats = batchMerchantMonths.get(normMerchant);
      if (batchStats && batchStats.months.size >= 3) {
        const avg =
          batchStats.amounts.reduce((s, v) => s + v, 0) / batchStats.amounts.length;
        const steady = batchStats.amounts.every(
          (a) => avg > 0 && Math.abs(a - avg) / avg <= 0.2
        );
        if (steady && avg <= 200) {
          suggestions.push({
            transactionId: tx.id,
            merchant: tx.merchant,
            description: tx.description,
            date: tx.date,
            amount: tx.amount,
            currentCategory: tx.category,
            suggestedCategory: 'subscriptions',
            suggestedClass: 'non-essential',
            reason: `Detected recurring monthly pattern (${batchStats.months.size} months at ~${avg.toFixed(2)})`,
            ruleSource: 'recurring_pattern',
            confidence: 84,
            matchPattern: normMerchant,
          });
        }
      }
    }
  }

  return suggestions;
}

export function applyCategorySuggestions(
  transactions: Transaction[],
  suggestions: CategoryRuleSuggestion[],
  acceptedIds?: Set<string>
): Transaction[] {
  const byTxId = new Map<string, CategoryRuleSuggestion>();
  for (const s of suggestions) {
    if (!acceptedIds || acceptedIds.has(s.transactionId)) {
      byTxId.set(s.transactionId, s);
    }
  }
  if (byTxId.size === 0) return transactions;

  return transactions.map((tx) => {
    const match = byTxId.get(tx.id);
    if (!match) return tx;
    return {
      ...tx,
      category: match.suggestedCategory,
      spendingClass: match.suggestedClass,
    };
  });
}

export interface DebtTimelinePoint {
  month: number;
  label: string;
  avalancheDebt: number;
  snowballDebt: number;
  savingsPathDebt: number;
  avalancheNetWorth: number;
  snowballNetWorth: number;
  savingsPathNetWorth: number;
  savingsPathIsaBalance: number;
}

export interface DebtAccountPayoffMilestone {
  debtId: string;
  payoffOrder: number;
  payoffMonth: number | null;
  payoffDateLabel: string;
  interestPaid: number;
}

export interface DebtMethodOutcome {
  monthsToDebtFree: number | null;
  debtFreeDateLabel: string;
  totalInterestPaid: number;
  firstDebtClearedMonth: number | null;
  finalDebtRemaining: number;
  finalIsaSavings: number;
  finalNetPosition: number;
  milestones: Record<string, DebtAccountPayoffMilestone>;
}

export interface DebtSimulationResult {
  totalStartingDebt: number;
  weightedAvgApr: number;
  totalMinimumMonthly: number;
  extraMonthlyBudget: number;
  totalMonthlyCommitted: number;
  horizonMonths: number;
  avalanche: DebtMethodOutcome;
  snowball: DebtMethodOutcome;
  savingsPath: DebtMethodOutcome;
  interestSavedAvalancheVsMinimum: number;
  interestSavedSnowballVsMinimum: number;
  avalancheInterestEdgeOverSnowball: number;
  monthsSavedAvalancheVsMinimum: number;
  netAdvantageAvalancheVsSavingsPath: number;
  netAdvantageSnowballVsSavingsPath: number;
  timeline: DebtTimelinePoint[];
}

function formatFutureMonthLabel(monthsFromNow: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsFromNow);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

interface InternalStrategyRun {
  debtSeries: number[];
  isaSeries: number[];
  netSeries: number[];
  monthsToDebtFree: number | null;
  totalInterestPaid: number;
  firstDebtClearedMonth: number | null;
  milestones: Record<string, DebtAccountPayoffMilestone>;
}

function runSingleDebtMethod(
  debts: DebtAccount[],
  mode: 'avalanche' | 'snowball' | 'savings_path',
  extraMonthlyBudget: number,
  monthlyIsaRate: number,
  maxMonths: number
): InternalStrategyRun {
  const balances = debts.map((d) => ({
    id: d.id,
    balance: Math.max(0, d.balance),
    apr: Math.max(0, d.apr),
    min: Math.max(0, d.minimumPayment),
    interestAccrued: 0,
    paidOffMonth: d.balance <= 0 ? 0 : (null as number | null),
  }));

  const orderedForMode = [...balances].sort((a, b) => {
    if (mode === 'avalanche') {
      if (b.apr !== a.apr) return b.apr - a.apr;
      return a.balance - b.balance;
    }
    if (a.balance !== b.balance) return a.balance - b.balance;
    return b.apr - a.apr;
  });

  const orderMap = new Map<string, number>();
  orderedForMode.forEach((item, idx) => orderMap.set(item.id, idx + 1));

  const totalMinimums = balances.reduce((s, b) => s + b.min, 0);
  const totalCommitted = totalMinimums + Math.max(0, extraMonthlyBudget);

  let isaBalance = 0;
  let totalInterestPaid = 0;
  let monthsToDebtFree: number | null = balances.every((b) => b.balance <= 0.01) ? 0 : null;
  let firstDebtClearedMonth: number | null = null;

  const startTotalDebt = balances.reduce((s, b) => s + b.balance, 0);
  const debtSeries: number[] = [Math.round(startTotalDebt)];
  const isaSeries: number[] = [0];
  const netSeries: number[] = [Math.round(-startTotalDebt)];

  for (let m = 1; m <= maxMonths; m++) {
    // 1. Accrue monthly interest on remaining balances
    for (const item of balances) {
      if (item.balance <= 0.01) continue;
      const interest = item.balance * (item.apr / 100 / 12);
      item.balance += interest;
      item.interestAccrued += interest;
      totalInterestPaid += interest;
    }

    // 2. Apply payments according to strategy
    let spentOnDebt = 0;

    if (mode === 'savings_path') {
      // Pay only required minimums on active debts; invest extraMonthlyBudget + freed minimums in Cash ISA
      for (const item of balances) {
        if (item.balance <= 0.01) continue;
        const pay = Math.min(item.balance, item.min);
        item.balance -= pay;
        spentOnDebt += pay;
        if (item.balance <= 0.01) {
          item.balance = 0;
          if (item.paidOffMonth === null) {
            item.paidOffMonth = m;
            if (firstDebtClearedMonth === null) firstDebtClearedMonth = m;
          }
        }
      }
      const monthlyToIsa = Math.max(0, totalCommitted - spentOnDebt);
      isaBalance = (isaBalance + monthlyToIsa) * (1 + monthlyIsaRate);
    } else {
      // Pay required minimums on all active debts first
      for (const item of balances) {
        if (item.balance <= 0.01) continue;
        const pay = Math.min(item.balance, item.min);
        item.balance -= pay;
        spentOnDebt += pay;
        if (item.balance <= 0.01) {
          item.balance = 0;
          if (item.paidOffMonth === null) {
            item.paidOffMonth = m;
            if (firstDebtClearedMonth === null) firstDebtClearedMonth = m;
          }
        }
      }

      // Roll all remaining committed cash (extra budget + freed minimums) into priority queue
      let snowballPool = Math.max(0, totalCommitted - spentOnDebt);
      const priorityTargets = [...balances]
        .filter((b) => b.balance > 0.01)
        .sort((a, b) => {
          if (mode === 'avalanche') {
            if (b.apr !== a.apr) return b.apr - a.apr;
            return a.balance - b.balance;
          }
          if (a.balance !== b.balance) return a.balance - b.balance;
          return b.apr - a.apr;
        });

      for (const target of priorityTargets) {
        if (snowballPool <= 0.01) break;
        const extraPay = Math.min(target.balance, snowballPool);
        target.balance -= extraPay;
        snowballPool -= extraPay;
        spentOnDebt += extraPay;
        if (target.balance <= 0.01) {
          target.balance = 0;
          if (target.paidOffMonth === null) {
            target.paidOffMonth = m;
            if (firstDebtClearedMonth === null) firstDebtClearedMonth = m;
          }
        }
      }

      // Once debts are cleared (or partially leftover), channel freed monthly cash into Cash ISA
      isaBalance = (isaBalance + snowballPool) * (1 + monthlyIsaRate);
    }

    const remainingDebt = balances.reduce((s, b) => s + b.balance, 0);
    if (remainingDebt <= 0.01 && monthsToDebtFree === null) {
      monthsToDebtFree = m;
    }

    debtSeries.push(Math.round(remainingDebt));
    isaSeries.push(Math.round(isaBalance));
    netSeries.push(Math.round(isaBalance - remainingDebt));
  }

  const milestones: Record<string, DebtAccountPayoffMilestone> = {};
  for (const item of balances) {
    milestones[item.id] = {
      debtId: item.id,
      payoffOrder: orderMap.get(item.id) ?? 1,
      payoffMonth: item.paidOffMonth,
      payoffDateLabel:
        item.paidOffMonth !== null ? formatFutureMonthLabel(item.paidOffMonth) : '30+ yrs',
      interestPaid: Math.round(item.interestAccrued),
    };
  }

  return {
    debtSeries,
    isaSeries,
    netSeries,
    monthsToDebtFree,
    totalInterestPaid: Math.round(totalInterestPaid),
    firstDebtClearedMonth,
    milestones,
  };
}

export function simulateDebtStrategies(
  debts: DebtAccount[],
  extraMonthlyBudget: number,
  cashIsaRatePct: number
): DebtSimulationResult {
  const activeDebts = debts.filter((d) => d.balance > 0);
  const totalStartingDebt = activeDebts.reduce((s, d) => s + d.balance, 0);
  const weightedAvgApr =
    totalStartingDebt > 0
      ? activeDebts.reduce((s, d) => s + d.balance * d.apr, 0) / totalStartingDebt
      : 0;
  const totalMinimumMonthly = activeDebts.reduce((s, d) => s + d.minimumPayment, 0);
  const safeExtra = Math.max(0, extraMonthlyBudget);
  const monthlyIsaRate = Math.max(0, cashIsaRatePct) / 100 / 12;

  if (activeDebts.length === 0) {
    const emptyOutcome: DebtMethodOutcome = {
      monthsToDebtFree: 0,
      debtFreeDateLabel: 'Debt-free',
      totalInterestPaid: 0,
      firstDebtClearedMonth: 0,
      finalDebtRemaining: 0,
      finalIsaSavings: 0,
      finalNetPosition: 0,
      milestones: {},
    };
    return {
      totalStartingDebt: 0,
      weightedAvgApr: 0,
      totalMinimumMonthly: 0,
      extraMonthlyBudget: safeExtra,
      totalMonthlyCommitted: safeExtra,
      horizonMonths: 0,
      avalanche: emptyOutcome,
      snowball: emptyOutcome,
      savingsPath: emptyOutcome,
      interestSavedAvalancheVsMinimum: 0,
      interestSavedSnowballVsMinimum: 0,
      avalancheInterestEdgeOverSnowball: 0,
      monthsSavedAvalancheVsMinimum: 0,
      netAdvantageAvalancheVsSavingsPath: 0,
      netAdvantageSnowballVsSavingsPath: 0,
      timeline: [],
    };
  }

  const MAX_SIM_MONTHS = 180; // 15-year cap for crisp charting & calculation
  const avalancheRun = runSingleDebtMethod(
    activeDebts,
    'avalanche',
    safeExtra,
    monthlyIsaRate,
    MAX_SIM_MONTHS
  );
  const snowballRun = runSingleDebtMethod(
    activeDebts,
    'snowball',
    safeExtra,
    monthlyIsaRate,
    MAX_SIM_MONTHS
  );
  const savingsPathRun = runSingleDebtMethod(
    activeDebts,
    'savings_path',
    safeExtra,
    monthlyIsaRate,
    MAX_SIM_MONTHS
  );

  // Pick a clean chart horizon covering the savings-path payoff (capped cleanly at 96 months or 12 months past debt payoff)
  const longestPayoff = Math.max(
    avalancheRun.monthsToDebtFree ?? 60,
    snowballRun.monthsToDebtFree ?? 60,
    savingsPathRun.monthsToDebtFree ?? 84
  );
  const horizonMonths = Math.max(12, Math.min(MAX_SIM_MONTHS, longestPayoff));

  // Sample points cleanly so the chart stays crisp on mobile & desktop
  const step = horizonMonths > 96 ? 3 : horizonMonths > 48 ? 2 : 1;
  const timeline: DebtTimelinePoint[] = [];
  for (let m = 0; m <= horizonMonths; m += step) {
    timeline.push({
      month: m,
      label: m === 0 ? 'Now' : m % 12 === 0 ? `Yr ${m / 12}` : `M${m}`,
      avalancheDebt: avalancheRun.debtSeries[m] ?? 0,
      snowballDebt: snowballRun.debtSeries[m] ?? 0,
      savingsPathDebt: savingsPathRun.debtSeries[m] ?? 0,
      avalancheNetWorth: avalancheRun.netSeries[m] ?? 0,
      snowballNetWorth: snowballRun.netSeries[m] ?? 0,
      savingsPathNetWorth: savingsPathRun.netSeries[m] ?? 0,
      savingsPathIsaBalance: savingsPathRun.isaSeries[m] ?? 0,
    });
  }
  if (timeline[timeline.length - 1]?.month !== horizonMonths) {
    timeline.push({
      month: horizonMonths,
      label:
        horizonMonths % 12 === 0
          ? `Yr ${horizonMonths / 12}`
          : `M${horizonMonths}`,
      avalancheDebt: avalancheRun.debtSeries[horizonMonths] ?? 0,
      snowballDebt: snowballRun.debtSeries[horizonMonths] ?? 0,
      savingsPathDebt: savingsPathRun.debtSeries[horizonMonths] ?? 0,
      avalancheNetWorth: avalancheRun.netSeries[horizonMonths] ?? 0,
      snowballNetWorth: snowballRun.netSeries[horizonMonths] ?? 0,
      savingsPathNetWorth: savingsPathRun.netSeries[horizonMonths] ?? 0,
      savingsPathIsaBalance: savingsPathRun.isaSeries[horizonMonths] ?? 0,
    });
  }

  const buildOutcome = (run: InternalStrategyRun): DebtMethodOutcome => ({
    monthsToDebtFree: run.monthsToDebtFree,
    debtFreeDateLabel:
      run.monthsToDebtFree !== null
        ? formatFutureMonthLabel(run.monthsToDebtFree)
        : '15+ years',
    totalInterestPaid: run.totalInterestPaid,
    firstDebtClearedMonth: run.firstDebtClearedMonth,
    finalDebtRemaining: run.debtSeries[horizonMonths] ?? 0,
    finalIsaSavings: run.isaSeries[horizonMonths] ?? 0,
    finalNetPosition: run.netSeries[horizonMonths] ?? 0,
    milestones: run.milestones,
  });

  const avalanche = buildOutcome(avalancheRun);
  const snowball = buildOutcome(snowballRun);
  const savingsPath = buildOutcome(savingsPathRun);

  return {
    totalStartingDebt: Math.round(totalStartingDebt),
    weightedAvgApr,
    totalMinimumMonthly: Math.round(totalMinimumMonthly),
    extraMonthlyBudget: Math.round(safeExtra),
    totalMonthlyCommitted: Math.round(totalMinimumMonthly + safeExtra),
    horizonMonths,
    avalanche,
    snowball,
    savingsPath,
    interestSavedAvalancheVsMinimum: Math.max(
      0,
      savingsPath.totalInterestPaid - avalanche.totalInterestPaid
    ),
    interestSavedSnowballVsMinimum: Math.max(
      0,
      savingsPath.totalInterestPaid - snowball.totalInterestPaid
    ),
    avalancheInterestEdgeOverSnowball: Math.max(
      0,
      snowball.totalInterestPaid - avalanche.totalInterestPaid
    ),
    monthsSavedAvalancheVsMinimum:
      savingsPath.monthsToDebtFree !== null && avalanche.monthsToDebtFree !== null
        ? Math.max(0, savingsPath.monthsToDebtFree - avalanche.monthsToDebtFree)
        : Math.max(0, horizonMonths - (avalanche.monthsToDebtFree ?? horizonMonths)),
    netAdvantageAvalancheVsSavingsPath:
      avalanche.finalNetPosition - savingsPath.finalNetPosition,
    netAdvantageSnowballVsSavingsPath:
      snowball.finalNetPosition - savingsPath.finalNetPosition,
    timeline,
  };
}

// ============================================================================
// Smart Search Auto-Tagging Engine ('Tax Deductible' & 'Expense Claimable')
// ============================================================================

interface SmartTagPatternRule {
  tag: SmartTagId;
  label: string;
  pattern: RegExp;
  reason: string;
  matchedPattern: string;
}

const SMART_TAG_PATTERN_RULES: SmartTagPatternRule[] = [
  // Tax Deductible patterns (self-employed / home-office / software / charity / professional)
  {
    tag: 'tax_deductible',
    label: 'Tax Deductible',
    pattern:
      /\b(backblaze|aws|amazon web|google cloud|github|vercel|figma|adobe|microsoft\s*365|office\s*365|notion|slack|zoom|dropbox|icloud|1password|openai|anthropic|chatgpt|claude|linear|jetbrains|cloudflare|digitalocean|heroku|canva|xero|quickbooks|freeagent|sage|apple\s*one)\b/i,
    reason: 'Cloud storage, business software, or SaaS tool',
    matchedPattern: 'Business software & cloud',
  },
  {
    tag: 'tax_deductible',
    label: 'Tax Deductible',
    pattern:
      /\b(virgin media|bt\s+broadband|bt\s+group|sky broadband|hyperoptic|broadband|fibre|fiber|ee\s+mobile|vodafone|o2\s+uk|three\s+mobile|giffgaff|starlink)\b/i,
    reason: 'Home-office broadband or business mobile proportion',
    matchedPattern: 'Home-office telecoms',
  },
  {
    tag: 'tax_deductible',
    label: 'Tax Deductible',
    pattern:
      /\b(octopus energy|british gas|edf\s+energy|ovo\s+energy|e\.?on\b|scottish\s+power|thames\s+water)\b/i,
    reason: 'Eligible home-office utility proportion',
    matchedPattern: 'Home-office utility',
  },
  {
    tag: 'tax_deductible',
    label: 'Tax Deductible',
    pattern:
      /\b(accountant|accounting|solicitor|legal\s+fee|hmrc|companies\s+house|wework|regus|coworking|coursera|udemy|o'?reilly|linkedin\s+learning|pluralsight|charit|justgiving|red\s+cross|oxfam|unicef|cancer\s+research|donation|gift\s+aid|sipp|pension\s+contrib|professional\s+body|indemnity)\b/i,
    reason: 'Professional fee, training, charity Gift Aid, or coworking',
    matchedPattern: 'Professional / charity / training',
  },
  {
    tag: 'tax_deductible',
    label: 'Tax Deductible',
    pattern:
      /\b(apple\s+store|currys|scan\s+computers|dell\b|lenovo|logitech|staples|ryman|viking\s+direct|office\s+depot)\b/i,
    reason: 'Work equipment, hardware, or office stationery',
    matchedPattern: 'Equipment & office supplies',
  },

  // Expense Claimable patterns (employer / client reimbursable travel, mileage, lodging, meals, couriers)
  {
    tag: 'expense_claimable',
    label: 'Expense Claimable',
    pattern:
      /\b(tfl|transport\s+for\s+london|trainline|national\s+rail|lner|avanti|gwr|great\s+western|eurostar|easyjet|british\s+airways|ryanair|lufthansa|delta\s+air|united\s+airlines|klm|air\s+france|heathrow\s+express|gatwick\s+express|stansted\s+express)\b/i,
    reason: 'Work travel, rail fare, or flight',
    matchedPattern: 'Travel & rail / flights',
  },
  {
    tag: 'expense_claimable',
    label: 'Expense Claimable',
    pattern:
      /\b(uber(?!\s*eats)|bolt\b|free\s*now|addison\s+lee|lyft|shell\b|bp\s+fuel|esso\b|texaco|ringgo|paybyphone|ncp\s+parking|apcoa|enterprise\s+rent|hertz|avis\b|sixt|zipcar)\b/i,
    reason: 'Business mileage, fuel, taxi, or parking',
    matchedPattern: 'Fuel, mileage & transit',
  },
  {
    tag: 'expense_claimable',
    label: 'Expense Claimable',
    pattern:
      /\b(airbnb|hilton|marriott|premier\s+inn|travelodge|ibis\b|holiday\s+inn|hyatt|booking\.com|expedia|hotel)\b/i,
    reason: 'Overnight business lodging or client travel stay',
    matchedPattern: 'Business accommodation',
  },
  {
    tag: 'expense_claimable',
    label: 'Expense Claimable',
    pattern:
      /\b(dishoom|pret\s+a\s+manger|pret\b|leon\b|itsu|wagamama|nando|pizza\s+express|gail'?s|starbucks|costa\b|caffe\s+nero|bistro|brasserie|steakhouse|restaurant)\b/i,
    reason: 'Client hospitality or on-site work subsistence',
    matchedPattern: 'Client meal / subsistence',
  },
  {
    tag: 'expense_claimable',
    label: 'Expense Claimable',
    pattern:
      /\b(royal\s+mail|dhl\b|fedex|ups\b|dpd\b|evri|post\s+office|ryman|staples|whsmith)\b/i,
    reason: 'Reimbursable postage, courier, or stationery',
    matchedPattern: 'Courier & office supplies',
  },
];

/**
 * Evaluates merchant & description patterns locally to auto-tag outflows as
 * 'Tax Deductible' and/or 'Expense Claimable'. Income and ISA/savings transfers
 * are never tagged as claimable/deductible expenses.
 */
export function detectTransactionSmartTags(tx: Transaction): SmartTagMatch[] {
  if (tx.amount >= 0 || tx.spendingClass === 'income' || tx.spendingClass === 'savings') {
    return [];
  }

  const haystack = `${tx.merchant} ${tx.description}`;
  const seen = new Set<SmartTagId>();
  const matches: SmartTagMatch[] = [];

  for (const rule of SMART_TAG_PATTERN_RULES) {
    if (seen.has(rule.tag)) continue;
    if (rule.pattern.test(haystack)) {
      seen.add(rule.tag);
      matches.push({
        tag: rule.tag,
        label: rule.label,
        reason: rule.reason,
        matchedPattern: rule.matchedPattern,
      });
    }
  }

  return matches;
}

/**
 * Computes Smart Search auto-tag map, counts, and display-currency totals
 * across the entire ledger.
 */
export function analyzeLedgerSmartTags(
  transactions: Transaction[],
  displayCurrency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>
): SmartTagSummary {
  const byTransactionId: Record<string, SmartTagMatch[]> = {};
  let taxDeductibleCount = 0;
  let expenseClaimableCount = 0;
  let eitherTagCount = 0;
  let taxDeductibleTotal = 0;
  let expenseClaimableTotal = 0;
  let eitherTagTotal = 0;

  for (const tx of transactions) {
    const tags = detectTransactionSmartTags(tx);
    if (tags.length === 0) continue;

    byTransactionId[tx.id] = tags;
    const absConverted = Math.abs(
      getTransactionDisplayAmount(tx, displayCurrency, exchangeRates)
    );

    const hasTax = tags.some((t) => t.tag === 'tax_deductible');
    const hasClaim = tags.some((t) => t.tag === 'expense_claimable');

    if (hasTax) {
      taxDeductibleCount += 1;
      taxDeductibleTotal += absConverted;
    }
    if (hasClaim) {
      expenseClaimableCount += 1;
      expenseClaimableTotal += absConverted;
    }
    if (hasTax || hasClaim) {
      eitherTagCount += 1;
      eitherTagTotal += absConverted;
    }
  }

  return {
    byTransactionId,
    taxDeductibleCount,
    expenseClaimableCount,
    eitherTagCount,
    taxDeductibleTotal,
    expenseClaimableTotal,
    eitherTagTotal,
  };
}

// ============================================================================
// 5-Year Total Net Worth Projection (Savings + Investment Growth − Debt)
// ============================================================================

export function computeBlendedIsaReturnPct(settings: IsaPlannerSettings): number {
  const totalSplit =
    settings.cashIsaSplitPct + settings.lisaSplitPct + settings.stocksIsaSplitPct;
  if (totalSplit <= 0) return settings.cashIsaRate;
  const weighted =
    (settings.cashIsaSplitPct * settings.cashIsaRate +
      settings.lisaSplitPct * settings.lisaRate +
      settings.stocksIsaSplitPct * settings.stocksIsaRate) /
    totalSplit;
  return Math.round(weighted * 100) / 100;
}

export interface FiveYearNetWorthParams {
  currentSavings: number;
  debts: DebtAccount[];
  monthlyContribution: number;
  extraDebtPayment: number;
  isaSettings: IsaPlannerSettings;
  annualReturnOverridePct?: number | null;
  debtStrategy?: NetWorthDebtStrategy;
}

/**
 * Projects total net worth (Savings & Investments minus Remaining Debt) over
 * the next 60 months (5 years), coupling:
 * 1. Starting savings balance
 * 2. Debt paydown across active balances & APRs (Avalanche, Snowball, or Minimums)
 * 3. Compounding investment growth on savings + ongoing contributions + freed debt cashflow
 */
export function computeFiveYearNetWorthProjection(
  params: FiveYearNetWorthParams
): FiveYearNetWorthProjection {
  const HORIZON_MONTHS = 60;
  const startingSavings = Math.max(0, params.currentSavings);
  const activeDebts = params.debts.filter((d) => d.balance > 0.01);
  const startingDebt = activeDebts.reduce((s, d) => s + d.balance, 0);
  const totalMinimumDebtPayment = activeDebts.reduce(
    (s, d) => s + Math.max(0, d.minimumPayment),
    0
  );
  const monthlySavingsContribution = Math.max(0, params.monthlyContribution);
  const strategy: NetWorthDebtStrategy = params.debtStrategy ?? 'avalanche';
  const extraMonthlyDebtPayment =
    activeDebts.length > 0 && strategy !== 'minimums_only'
      ? Math.max(0, params.extraDebtPayment)
      : 0;

  const blendedAnnualReturnPct =
    params.annualReturnOverridePct !== null &&
    params.annualReturnOverridePct !== undefined &&
    Number.isFinite(params.annualReturnOverridePct)
      ? Math.max(0, Math.min(20, params.annualReturnOverridePct))
      : computeBlendedIsaReturnPct(params.isaSettings);

  const monthlyInvestRate = blendedAnnualReturnPct / 100 / 12;
  const monthlyCurrentAccRate = Math.max(0, params.isaSettings.currentAccountRate) / 100 / 12;

  // LISA bonus (25% on LISA share, capped at £4,000/yr) applies when using blended ISA split
  const includeLisaBonus =
    params.annualReturnOverridePct === null || params.annualReturnOverridePct === undefined;
  const lisaShareFraction = Math.max(0, Math.min(1, params.isaSettings.lisaSplitPct / 100));

  // Active plan mutable state
  const planDebts = activeDebts.map((d) => ({
    balance: d.balance,
    apr: Math.max(0, d.apr),
    min: Math.max(0, d.minimumPayment),
  }));
  let planAssets = startingSavings;
  let cumulativeContributions = 0;
  let cumulativeGrowth = 0;
  let cumulativeDebtPaid = 0;
  let totalInterestPaid5Y = 0;
  let debtFreeMonth: number | null = startingDebt <= 0.01 ? 0 : null;
  let zeroCrossMonth: number | null = startingSavings - startingDebt >= 0 ? 0 : null;

  // Baseline mutable state (minimum debt payments only + current account interest)
  const baseDebts = activeDebts.map((d) => ({
    balance: d.balance,
    apr: Math.max(0, d.apr),
    min: Math.max(0, d.minimumPayment),
  }));
  let baseAssets = startingSavings;

  const totalDebtCashBudget = totalMinimumDebtPayment + extraMonthlyDebtPayment;
  const points: NetWorthProjectionPoint[] = [];

  const nowDate = new Date();
  const formatMonthYear = (offset: number) => {
    const dt = new Date(nowDate.getFullYear(), nowDate.getMonth() + offset, 1);
    return `${MONTH_NAMES[dt.getMonth()]} ${dt.getFullYear()}`;
  };

  points.push({
    month: 0,
    label: 'Now',
    dateLabel: formatMonthYear(0),
    assets: Math.round(planAssets),
    debt: Math.round(startingDebt),
    netWorth: Math.round(planAssets - startingDebt),
    baselineNetWorth: Math.round(baseAssets - startingDebt),
    cumulativeContributions: 0,
    cumulativeGrowth: 0,
    cumulativeDebtPaid: 0,
  });

  for (let m = 1; m <= HORIZON_MONTHS; m++) {
    // --- 1. Active Plan Debt Accrual & Paydown ---
    for (const d of planDebts) {
      if (d.balance <= 0.01) continue;
      const interest = d.balance * (d.apr / 100 / 12);
      d.balance += interest;
      totalInterestPaid5Y += interest;
    }

    let spentOnDebt = 0;
    for (const d of planDebts) {
      if (d.balance <= 0.01) continue;
      const pay = Math.min(d.balance, d.min);
      d.balance -= pay;
      spentOnDebt += pay;
      if (d.balance <= 0.01) d.balance = 0;
    }

    let extraPool = Math.max(0, totalDebtCashBudget - spentOnDebt);
    if (strategy !== 'minimums_only' && extraPool > 0.01) {
      const targets = [...planDebts]
        .filter((d) => d.balance > 0.01)
        .sort((a, b) => {
          if (strategy === 'avalanche') {
            if (b.apr !== a.apr) return b.apr - a.apr;
            return a.balance - b.balance;
          }
          if (a.balance !== b.balance) return a.balance - b.balance;
          return b.apr - a.apr;
        });

      for (const t of targets) {
        if (extraPool <= 0.01) break;
        const pay = Math.min(t.balance, extraPool);
        t.balance -= pay;
        extraPool -= pay;
        spentOnDebt += pay;
        if (t.balance <= 0.01) t.balance = 0;
      }
    }

    cumulativeDebtPaid += spentOnDebt;
    const remainingDebt = planDebts.reduce((s, d) => s + d.balance, 0);
    if (remainingDebt <= 0.01 && debtFreeMonth === null) {
      debtFreeMonth = m;
    }

    // Any freed debt payments (once debts clear) automatically roll into compounding investments
    const rolledDebtToInvest = strategy === 'minimums_only'
      ? Math.max(0, totalMinimumDebtPayment - spentOnDebt)
      : extraPool;

    const monthContrib = monthlySavingsContribution + rolledDebtToInvest;
    const lisaEligibleMonthly = includeLisaBonus
      ? Math.min(monthContrib * lisaShareFraction, 4000 / 12)
      : 0;
    const lisaBonus = lisaEligibleMonthly * 0.25;

    const preGrowthAssets = planAssets + monthContrib + lisaBonus;
    const monthlyGrowth = preGrowthAssets * monthlyInvestRate;
    planAssets = preGrowthAssets + monthlyGrowth;

    cumulativeContributions += monthContrib;
    cumulativeGrowth += monthlyGrowth + lisaBonus;

    // --- 2. Baseline Path (Minimum debt payments only + low-yield current account) ---
    for (const d of baseDebts) {
      if (d.balance <= 0.01) continue;
      d.balance += d.balance * (d.apr / 100 / 12);
    }
    let baseSpentDebt = 0;
    for (const d of baseDebts) {
      if (d.balance <= 0.01) continue;
      const pay = Math.min(d.balance, d.min);
      d.balance -= pay;
      baseSpentDebt += pay;
      if (d.balance <= 0.01) d.balance = 0;
    }
    const baseRemainingDebt = baseDebts.reduce((s, d) => s + d.balance, 0);
    const baseFreedMin = Math.max(0, totalMinimumDebtPayment - baseSpentDebt);
    baseAssets =
      (baseAssets + monthlySavingsContribution + baseFreedMin) * (1 + monthlyCurrentAccRate);

    const netWorth = planAssets - remainingDebt;
    if (netWorth >= 0 && zeroCrossMonth === null) {
      zeroCrossMonth = m;
    }

    points.push({
      month: m,
      label: m % 12 === 0 ? `Yr ${m / 12}` : `M${m}`,
      dateLabel: formatMonthYear(m),
      assets: Math.round(planAssets),
      debt: Math.round(remainingDebt),
      netWorth: Math.round(netWorth),
      baselineNetWorth: Math.round(baseAssets - baseRemainingDebt),
      cumulativeContributions: Math.round(cumulativeContributions),
      cumulativeGrowth: Math.round(cumulativeGrowth),
      cumulativeDebtPaid: Math.round(cumulativeDebtPaid),
    });
  }

  const lastPt = points[points.length - 1];
  const startingNetWorth = Math.round(startingSavings - startingDebt);

  return {
    startingSavings: Math.round(startingSavings),
    startingDebt: Math.round(startingDebt),
    startingNetWorth,
    projectedAssets5Y: lastPt.assets,
    projectedDebt5Y: lastPt.debt,
    projectedNetWorth5Y: lastPt.netWorth,
    baselineNetWorth5Y: lastPt.baselineNetWorth,
    netWorthGain5Y: lastPt.netWorth - startingNetWorth,
    totalInvestmentGrowth5Y: Math.round(cumulativeGrowth),
    totalDebtReduced5Y: Math.max(0, Math.round(startingDebt - lastPt.debt)),
    totalInterestPaid5Y: Math.round(totalInterestPaid5Y),
    blendedAnnualReturnPct,
    monthlySavingsContribution: Math.round(monthlySavingsContribution),
    extraMonthlyDebtPayment: Math.round(extraMonthlyDebtPayment),
    totalMinimumDebtPayment: Math.round(totalMinimumDebtPayment),
    debtFreeMonth,
    debtFreeDateLabel:
      debtFreeMonth === null
        ? null
        : debtFreeMonth === 0
          ? 'Debt-free'
          : formatMonthYear(debtFreeMonth),
    zeroCrossMonth,
    points,
  };
}

// ============================================================================
// Historical Variance Spending Trend Projection (Next-Month Category Forecast)
// ============================================================================

export interface VarianceProjectionOptions {
  /** Reference date used to detect whether the trailing month is still in progress. Defaults to `new Date()`. */
  referenceDate?: Date;
  /** Exclude an incomplete trailing month from the statistical fit to avoid downward forecast bias. Defaults to `true`. */
  excludePartialTrailingMonth?: boolean;
  /** Opt-in: pro-rate the incomplete trailing month to a full-month pace and include it in the baseline fit. Defaults to `false`. */
  proRatePartialMonth?: boolean;
  /** Currency unit of `categoryCaps` if different from `displayCurrency`. Defaults to `displayCurrency`. */
  capsCurrency?: CurrencyCode;
  /** Net positive refunds assigned to spending categories against outflows. Defaults to `true`. */
  netRefunds?: boolean;
}

export interface MonthCompletenessResult {
  monthKey: string;
  complete: boolean;
  daysElapsed: number;
  daysInMonth: number;
  reason: 'complete' | 'current_month_in_progress' | 'mid_month_cutoff';
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundPence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function toCalendarMonthIndex(monthKey: string): number {
  const [yStr, mStr] = monthKey.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
  return y * 12 + (m - 1);
}

/**
 * Determines whether a statement month (`YYYY-MM`) represents a complete calendar month
 * or partial data (either the current calendar month still in progress or a mid-month
 * statement export cutoff compared to prior months' coverage).
 */
export function isMonthComplete(
  monthKey: string,
  maxObservedDayInMonth: number | null,
  priorMonthMaxDays: number[] = [],
  referenceDate: Date = new Date()
): MonthCompletenessResult {
  const [yStr, mStr] = monthKey.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return {
      monthKey,
      complete: true,
      daysElapsed: 30,
      daysInMonth: 30,
      reason: 'complete',
    };
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const refMonthKey = `${referenceDate.getFullYear()}-${String(
    referenceDate.getMonth() + 1
  ).padStart(2, '0')}`;
  const observedMaxDay =
    maxObservedDayInMonth !== null && Number.isFinite(maxObservedDayInMonth)
      ? Math.min(daysInMonth, Math.max(1, maxObservedDayInMonth))
      : daysInMonth;

  // 1. Live current calendar month that has not yet reached its final day
  if (monthKey === refMonthKey && referenceDate.getDate() < daysInMonth) {
    const daysElapsed = Math.min(daysInMonth, Math.max(observedMaxDay, referenceDate.getDate()));
    return {
      monthKey,
      complete: false,
      daysElapsed,
      daysInMonth,
      reason: 'current_month_in_progress',
    };
  }

  // 2. Historical mid-month export cutoff compared against prior statement coverage
  if (priorMonthMaxDays.length > 0) {
    const priorMedianMaxDay = computeMedian(priorMonthMaxDays);
    const isMidMonthCutoff =
      (observedMaxDay <= daysInMonth - 5 &&
        priorMedianMaxDay >= 25 &&
        priorMedianMaxDay - observedMaxDay >= 5) ||
      (observedMaxDay <= 7 &&
        priorMedianMaxDay >= 14 &&
        priorMedianMaxDay - observedMaxDay >= 7);

    if (isMidMonthCutoff) {
      return {
        monthKey,
        complete: false,
        daysElapsed: observedMaxDay,
        daysInMonth,
        reason: 'mid_month_cutoff',
      };
    }
  }

  return {
    monthKey,
    complete: true,
    daysElapsed: daysInMonth,
    daysInMonth,
    reason: 'complete',
  };
}

/**
 * Uses historical monthly transaction variance (mean, sample standard deviation,
 * and dampened OLS linear trend over elapsed calendar months) to estimate next
 * month's spending per category and evaluate 'projected vs. limit' warnings.
 *
 * Statistical safeguards:
 * 1. Returns `insufficient_data` (never `NaN` or `on_track`) when a capped category
 *    or empty ledger has 0 observed spending months.
 * 2. Uses `isMonthComplete()` to detect partial trailing months; excludes them from
 *    the baseline by default (preventing downward bias), or pro-rates them only when
 *    `options.proRatePartialMonth === true`.
 * 3. Fits each category over its active window (`monthsObserved` starting from its
 *    first non-zero month) so leading structural zeros never dilute mean or inflate stdDev.
 * 4. Computes OLS slope over actual elapsed calendar months (so Jan -> Apr is 3 months,
 *    not 1 array slot).
 * 5. Retains pence precision (2 decimals) in returned amounts and evaluates riskStatus
 *    on the rounded figures so warnings never contradict displayed numbers.
 * 6. Nets positive refunds tagged to spending categories against outflows by default
 *    and optionally converts `categoryCaps` when `capsCurrency !== displayCurrency`.
 */
export function computeCategoryVarianceProjections(
  transactions: Transaction[],
  categoryCaps: Partial<Record<CategoryId, number>> | undefined,
  displayCurrency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>,
  options?: VarianceProjectionOptions
): SpendingTrendProjectionSummary {
  const caps = categoryCaps ?? {};
  const excludePartialTrailingMonth = options?.excludePartialTrailingMonth ?? true;
  const proRatePartialMonth = options?.proRatePartialMonth ?? false;
  const netRefunds = options?.netRefunds ?? true;
  const capsCurrency = options?.capsCurrency ?? displayCurrency;
  const refDate = options?.referenceDate ?? new Date();

  const monthSet = new Set<string>();
  const maxDayByMonth = new Map<string, number>();
  const monthlyCategoryTotals = new Map<string, Map<CategoryId, number>>();

  for (const tx of transactions) {
    if (!tx.date || tx.date.length < 7) continue;
    const mk = tx.date.slice(0, 7);
    monthSet.add(mk);

    const dayNum = parseInt(tx.date.slice(8, 10), 10);
    if (Number.isFinite(dayNum) && dayNum >= 1 && dayNum <= 31) {
      const prevMax = maxDayByMonth.get(mk) ?? 0;
      if (dayNum > prevMax) maxDayByMonth.set(mk, dayNum);
    }

    const isNonSpendingClass =
      tx.spendingClass === 'income' ||
      tx.spendingClass === 'savings' ||
      tx.category === 'salary_income' ||
      tx.category === 'other_income' ||
      tx.category === 'savings_investment';
    if (isNonSpendingClass) continue;

    if (!netRefunds && tx.amount >= 0) continue;

    // Outflows are negative amounts -> positive spend; positive amounts on spending
    // categories represent refunds -> reduce that month's category spend.
    const convertedSigned = getTransactionDisplayAmount(tx, displayCurrency, exchangeRates);
    const expenseDelta = -convertedSigned;

    let catMap = monthlyCategoryTotals.get(mk);
    if (!catMap) {
      catMap = new Map<CategoryId, number>();
      monthlyCategoryTotals.set(mk, catMap);
    }
    catMap.set(tx.category, (catMap.get(tx.category) ?? 0) + expenseDelta);
  }

  const sortedMonths = Array.from(monthSet).sort();

  // Derive the next calendar month label right after the latest statement month
  let nextMonthLabel = 'Next Month';
  if (sortedMonths.length > 0) {
    const [lastYStr, lastMStr] = sortedMonths[sortedMonths.length - 1].split('-');
    const lastY = parseInt(lastYStr, 10);
    const lastM = parseInt(lastMStr, 10);
    if (Number.isFinite(lastY) && Number.isFinite(lastM)) {
      const nextDt = new Date(lastY, lastM, 1); // JS month is 0-indexed, so lastM is already +1
      nextMonthLabel = `${MONTH_NAMES[nextDt.getMonth()]} ${nextDt.getFullYear()}`;
    }
  }

  // Empty ledger guard: never divide by 0 (NaN) or return `on_track` for capped categories
  if (sortedMonths.length === 0) {
    const emptyCategories: CategoryVarianceProjection[] = [];
    for (const categoryId of SPENDING_CATEGORY_IDS) {
      const rawCap = caps[categoryId];
      if (typeof rawCap !== 'number' || rawCap <= 0) continue;
      const monthlyCap = roundPence(
        convertAmount(rawCap, capsCurrency, displayCurrency, exchangeRates)
      );
      const meta = CATEGORIES[categoryId];
      emptyCategories.push({
        categoryId,
        label: meta.label,
        spendingClass: meta.defaultClass,
        monthsObserved: 0,
        historicalMean: 0,
        stdDev: 0,
        coefficientOfVariation: 0,
        trendSlopePerMonth: 0,
        projectedNextMonth: 0,
        lowerBoundSpend: 0,
        upperBoundSpend: 0,
        monthlyCap,
        projectedVsLimitDelta: null,
        upperVsLimitDelta: null,
        partialMonthActual: null,
        partialMonthProRated: null,
        riskStatus: 'insufficient_data',
      });
    }
    return {
      nextMonthLabel,
      monthsAnalyzed: 0,
      partialMonthMode: 'none',
      partialMonthKey: null,
      partialMonthLabel: null,
      partialMonthDaysElapsed: null,
      partialMonthDaysInMonth: null,
      excludedPartialMonth: null,
      excludedPartialMonthLabel: null,
      excludedPartialMonthDaysElapsed: null,
      totalProjectedNextMonth: 0,
      totalUpperBound: 0,
      totalHistoricalMean: 0,
      projectedDeltaPct: 0,
      projectedOverLimitCount: 0,
      varianceRiskCount: 0,
      categories: emptyCategories,
    };
  }

  // Check completeness of the trailing month via `isMonthComplete`
  let partialMonthMode: SpendingTrendProjectionSummary['partialMonthMode'] = 'none';
  let partialMonthKey: string | null = null;
  let partialMonthLabel: string | null = null;
  let partialMonthDaysElapsed: number | null = null;
  let partialMonthDaysInMonth: number | null = null;
  let excludedPartialMonth: string | null = null;
  let excludedPartialMonthLabel: string | null = null;
  let excludedPartialMonthDaysElapsed: number | null = null;
  let proRateFactor = 1;
  let fittedMonths = sortedMonths;

  const lastMk = sortedMonths[sortedMonths.length - 1];
  const priorMaxDays = sortedMonths
    .slice(0, -1)
    .map((mk) => maxDayByMonth.get(mk) ?? 28);
  const completeness = isMonthComplete(
    lastMk,
    maxDayByMonth.get(lastMk) ?? null,
    priorMaxDays,
    refDate
  );

  if (!completeness.complete) {
    partialMonthKey = lastMk;
    partialMonthLabel = formatMonthLabel(lastMk);
    partialMonthDaysElapsed = completeness.daysElapsed;
    partialMonthDaysInMonth = completeness.daysInMonth;
    proRateFactor = completeness.daysInMonth / Math.max(1, completeness.daysElapsed);

    if (proRatePartialMonth) {
      // User opted in: include the trailing month pro-rated to a full-month pace
      partialMonthMode = 'prorated';
      fittedMonths = sortedMonths;
    } else if (excludePartialTrailingMonth && sortedMonths.length >= 2) {
      // Default: exclude incomplete trailing month from baseline fit to avoid downward bias
      partialMonthMode = 'excluded';
      excludedPartialMonth = lastMk;
      excludedPartialMonthLabel = partialMonthLabel;
      excludedPartialMonthDaysElapsed = completeness.daysElapsed;
      fittedMonths = sortedMonths.slice(0, -1);
    } else if (sortedMonths.length === 1) {
      // Single partial month only: flag as partial data without fabricating baseline
      partialMonthMode = 'excluded';
      excludedPartialMonth = lastMk;
      excludedPartialMonthLabel = partialMonthLabel;
      excludedPartialMonthDaysElapsed = completeness.daysElapsed;
    }
  }

  const monthsAnalyzed = fittedMonths.length;
  const categories: CategoryVarianceProjection[] = [];

  for (const categoryId of SPENDING_CATEGORY_IDS) {
    const fullSeries = fittedMonths.map((mk) => {
      const rawMonthSpend = Math.max(
        0,
        monthlyCategoryTotals.get(mk)?.get(categoryId) ?? 0
      );
      if (partialMonthMode === 'prorated' && mk === partialMonthKey) {
        return rawMonthSpend * proRateFactor;
      }
      return rawMonthSpend;
    });

    const partialMonthActual =
      partialMonthKey !== null
        ? roundPence(
            Math.max(0, monthlyCategoryTotals.get(partialMonthKey)?.get(categoryId) ?? 0)
          )
        : null;
    const partialMonthProRated =
      partialMonthActual !== null ? roundPence(partialMonthActual * proRateFactor) : null;

    const rawCap = caps[categoryId];
    const monthlyCap =
      typeof rawCap === 'number' && rawCap > 0
        ? roundPence(convertAmount(rawCap, capsCurrency, displayCurrency, exchangeRates))
        : null;

    const firstNonZeroIdx = fullSeries.findIndex((v) => v > 0);
    if (firstNonZeroIdx === -1) {
      if (monthlyCap === null) continue;
      const meta = CATEGORIES[categoryId];
      categories.push({
        categoryId,
        label: meta.label,
        spendingClass: meta.defaultClass,
        monthsObserved: 0,
        historicalMean: 0,
        stdDev: 0,
        coefficientOfVariation: 0,
        trendSlopePerMonth: 0,
        projectedNextMonth: 0,
        lowerBoundSpend: 0,
        upperBoundSpend: 0,
        monthlyCap,
        projectedVsLimitDelta: null,
        upperVsLimitDelta: null,
        partialMonthActual,
        partialMonthProRated,
        riskStatus: 'insufficient_data',
      });
      continue;
    }

    // Ignore structural zeros prior to the category's first appearance;
    // compute mean, stdDev, and OLS trend over the category's `monthsObserved` active window.
    const activeMonths = fittedMonths.slice(firstNonZeroIdx);
    const activeSeries = fullSeries.slice(firstNonZeroIdx);
    const n = activeSeries.length;
    const totalSpent = activeSeries.reduce((s, v) => s + v, 0);
    const mean = totalSpent / n;

    // Sample variance & standard deviation across the category's active months
    let sqDiffSum = 0;
    for (const v of activeSeries) {
      sqDiffSum += (v - mean) * (v - mean);
    }
    const variance = n > 1 ? sqDiffSum / (n - 1) : 0;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = mean > 0 ? stdDev / mean : 0;

    // Ordinary least-squares linear trend slope across ELAPSED CALENDAR MONTHS
    // so gaps like Jan -> Apr are 3 calendar months apart, not 1 array slot.
    const calIndices = activeMonths.map(toCalendarMonthIndex);
    const meanX = calIndices.reduce((s, x) => s + x, 0) / n;
    let slope = 0;
    if (n >= 2) {
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        const dx = calIndices[i] - meanX;
        num += dx * (activeSeries[i] - mean);
        den += dx * dx;
      }
      slope = den > 0 ? num / den : 0;
    }

    // Recent 3-month momentum relative to the category's active mean
    const recentSlice = activeSeries.slice(-Math.min(3, n));
    const recentMean =
      recentSlice.reduce((s, v) => s + v, 0) / Math.max(1, recentSlice.length);

    // Next-step OLS delta evaluated 1 calendar month beyond the latest fitted month,
    // dampened (0.45) and blended with recent 3-month momentum (0.35).
    const nextCalendarStepX = calIndices[n - 1] + 1;
    const rawForecast =
      mean + slope * (nextCalendarStepX - meanX) * 0.45 + (recentMean - mean) * 0.35;

    // Clamp forecast within a realistic band of [0, max(peak*1.15, mean + 1.5*stdDev)]
    const maxObserved = Math.max(...activeSeries, mean);
    const upperClamp = Math.max(maxObserved * 1.15, mean + stdDev * 1.5);
    const projectedNextMonth = roundPence(Math.max(0, Math.min(upperClamp, rawForecast)));
    const roundedStdDev = roundPence(stdDev);

    // Variance-adjusted 1-sigma confidence interval (pence-consistent with projectedNextMonth)
    const upperBoundSpend = roundPence(projectedNextMonth + roundedStdDev);
    const lowerBoundSpend = roundPence(Math.max(0, projectedNextMonth - roundedStdDev));

    const projectedVsLimitDelta =
      monthlyCap !== null ? roundPence(projectedNextMonth - monthlyCap) : null;
    const upperVsLimitDelta =
      monthlyCap !== null ? roundPence(upperBoundSpend - monthlyCap) : null;

    let riskStatus: CategoryVarianceProjection['riskStatus'] = 'uncapped';
    if (monthlyCap !== null) {
      if (projectedNextMonth > monthlyCap) {
        riskStatus = 'projected_over';
      } else if (upperBoundSpend > monthlyCap) {
        riskStatus = 'variance_risk';
      } else {
        riskStatus = 'on_track';
      }
    }

    const meta = CATEGORIES[categoryId];
    categories.push({
      categoryId,
      label: meta.label,
      spendingClass: meta.defaultClass,
      monthsObserved: n,
      historicalMean: roundPence(mean),
      stdDev: roundedStdDev,
      coefficientOfVariation,
      trendSlopePerMonth: Math.round(slope * 100) / 100,
      projectedNextMonth,
      lowerBoundSpend,
      upperBoundSpend,
      monthlyCap,
      projectedVsLimitDelta,
      upperVsLimitDelta,
      partialMonthActual,
      partialMonthProRated,
      riskStatus,
    });
  }

  const severityOrder: Record<CategoryVarianceProjection['riskStatus'], number> = {
    projected_over: 0,
    variance_risk: 1,
    on_track: 2,
    insufficient_data: 3,
    uncapped: 4,
  };

  categories.sort((a, b) => {
    const diff = severityOrder[a.riskStatus] - severityOrder[b.riskStatus];
    if (diff !== 0) return diff;
    return b.projectedNextMonth - a.projectedNextMonth;
  });

  const totalHistoricalMean = roundPence(
    categories.reduce((s, c) => s + c.historicalMean, 0)
  );
  const totalProjectedNextMonth = roundPence(
    categories.reduce((s, c) => s + c.projectedNextMonth, 0)
  );
  // Portfolio-level upper bound uses RMS variance (assuming independent category fluctuations)
  const portfolioStdDev = Math.sqrt(
    categories.reduce((s, c) => s + c.stdDev * c.stdDev, 0)
  );
  const totalUpperBound = roundPence(totalProjectedNextMonth + portfolioStdDev);
  const projectedDeltaPct =
    totalHistoricalMean > 0
      ? ((totalProjectedNextMonth - totalHistoricalMean) / totalHistoricalMean) * 100
      : 0;

  return {
    nextMonthLabel,
    monthsAnalyzed,
    partialMonthMode,
    partialMonthKey,
    partialMonthLabel,
    partialMonthDaysElapsed,
    partialMonthDaysInMonth,
    excludedPartialMonth,
    excludedPartialMonthLabel,
    excludedPartialMonthDaysElapsed,
    totalProjectedNextMonth,
    totalUpperBound,
    totalHistoricalMean,
    projectedDeltaPct,
    projectedOverLimitCount: categories.filter((c) => c.riskStatus === 'projected_over')
      .length,
    varianceRiskCount: categories.filter((c) => c.riskStatus === 'variance_risk').length,
    categories,
  };
}

export interface TopMerchantSeriesMeta {
  key: string;
  merchant: string;
  categoryId: CategoryId;
  categoryLabel: string;
  totalSpend: number;
  monthlyAvg: number;
  txCount: number;
  sharePct: number;
  color: string;
}

export interface TopMerchantTimePoint {
  monthKey: string;
  label: string;
  total: number;
  [merchantKey: string]: string | number;
}

export interface TopMerchantsOverTimeResult {
  months: TopMerchantTimePoint[];
  merchants: TopMerchantSeriesMeta[];
  activeCategories: Array<{
    categoryId: CategoryId;
    label: string;
    totalSpend: number;
  }>;
  totalSpend: number;
  monthCount: number;
}

const MERCHANT_CHART_PALETTE = [
  '#0f766e', // teal-700
  '#0284c7', // sky-600
  '#d97706', // amber-600
  '#4f46e5', // indigo-600
  '#334155', // slate-700
  '#059669', // emerald-600
  '#e11d48', // rose-600
  '#7c3aed', // violet-600
];

/**
 * Computes a chronological monthly bar-chart series of the top spending merchants,
 * optionally filtered to a single spending category, with pence-accurate totals.
 */
export function computeTopMerchantsByCategoryOverTime(
  transactions: Transaction[],
  categoryFilter: CategoryId | 'all' = 'all',
  displayCurrency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>,
  topN = 5,
  maxMonths = 12
): TopMerchantsOverTimeResult {
  const spendingTxs = transactions.filter(
    (tx) =>
      tx.spendingClass !== 'income' &&
      tx.spendingClass !== 'savings' &&
      tx.amount < 0 &&
      tx.date.length >= 7
  );

  // Build active categories across all spending transactions for the category dropdown
  const catSpendMap = new Map<CategoryId, number>();
  for (const tx of spendingTxs) {
    const absAmt = Math.abs(
      getTransactionDisplayAmount(tx, displayCurrency, exchangeRates)
    );
    catSpendMap.set(tx.category, (catSpendMap.get(tx.category) ?? 0) + absAmt);
  }
  const activeCategories = Array.from(catSpendMap.entries())
    .map(([categoryId, totalSpend]) => ({
      categoryId,
      label: CATEGORIES[categoryId]?.label ?? categoryId,
      totalSpend: roundPence(totalSpend),
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend);

  const scopedTxs =
    categoryFilter === 'all'
      ? spendingTxs
      : spendingTxs.filter((tx) => tx.category === categoryFilter);

  if (scopedTxs.length === 0) {
    return {
      months: [],
      merchants: [],
      activeCategories,
      totalSpend: 0,
      monthCount: 0,
    };
  }

  const allMonthKeys = Array.from(
    new Set(scopedTxs.map((tx) => tx.date.slice(0, 7)))
  ).sort();
  const windowMonths =
    maxMonths > 0 ? allMonthKeys.slice(-maxMonths) : allMonthKeys;
  const windowMonthSet = new Set(windowMonths);

  const merchAgg = new Map<
    string,
    {
      merchant: string;
      categoryId: CategoryId;
      totalSpend: number;
      txCount: number;
      byMonth: Map<string, number>;
    }
  >();

  let totalSpend = 0;

  for (const tx of scopedTxs) {
    const mk = tx.date.slice(0, 7);
    if (!windowMonthSet.has(mk)) continue;
    const absAmt = Math.abs(
      getTransactionDisplayAmount(tx, displayCurrency, exchangeRates)
    );
    totalSpend += absAmt;

    const normKey = `${tx.merchant.trim().toLowerCase()}__${tx.category}`;
    const prev = merchAgg.get(normKey) ?? {
      merchant: tx.merchant.trim() || 'Unknown Merchant',
      categoryId: tx.category,
      totalSpend: 0,
      txCount: 0,
      byMonth: new Map<string, number>(),
    };
    prev.totalSpend += absAmt;
    prev.txCount += 1;
    prev.byMonth.set(mk, (prev.byMonth.get(mk) ?? 0) + absAmt);
    merchAgg.set(normKey, prev);
  }

  const sortedMerchants = Array.from(merchAgg.values()).sort(
    (a, b) => b.totalSpend - a.totalSpend
  );
  const topMerchants = sortedMerchants.slice(0, Math.max(1, topN));
  const otherMerchants = sortedMerchants.slice(Math.max(1, topN));
  const monthCount = Math.max(windowMonths.length, 1);
  const roundedTotalSpend = roundPence(totalSpend);

  const merchants: TopMerchantSeriesMeta[] = topMerchants.map((m, idx) => ({
    key: `m_${idx}`,
    merchant: m.merchant,
    categoryId: m.categoryId,
    categoryLabel: CATEGORIES[m.categoryId]?.label ?? m.categoryId,
    totalSpend: roundPence(m.totalSpend),
    monthlyAvg: roundPence(m.totalSpend / monthCount),
    txCount: m.txCount,
    sharePct: roundedTotalSpend > 0 ? (m.totalSpend / roundedTotalSpend) * 100 : 0,
    color: MERCHANT_CHART_PALETTE[idx % MERCHANT_CHART_PALETTE.length],
  }));

  const otherTotal = roundPence(
    otherMerchants.reduce((s, m) => s + m.totalSpend, 0)
  );
  const otherTxCount = otherMerchants.reduce((s, m) => s + m.txCount, 0);
  const hasOther = otherTotal > 0;
  if (hasOther) {
    merchants.push({
      key: 'm_other',
      merchant: `Other (${otherMerchants.length} merchants)`,
      categoryId: categoryFilter === 'all' ? 'other_discretionary' : categoryFilter,
      categoryLabel:
        categoryFilter === 'all'
          ? 'Multiple categories'
          : (CATEGORIES[categoryFilter]?.label ?? categoryFilter),
      totalSpend: otherTotal,
      monthlyAvg: roundPence(otherTotal / monthCount),
      txCount: otherTxCount,
      sharePct: roundedTotalSpend > 0 ? (otherTotal / roundedTotalSpend) * 100 : 0,
      color: '#94a3b8',
    });
  }

  const months: TopMerchantTimePoint[] = windowMonths.map((mk) => {
    const point: TopMerchantTimePoint = {
      monthKey: mk,
      label: formatMonthLabel(mk),
      total: 0,
    };
    let monthTotal = 0;

    topMerchants.forEach((m, idx) => {
      const val = roundPence(m.byMonth.get(mk) ?? 0);
      point[`m_${idx}`] = val;
      monthTotal += val;
    });

    if (hasOther) {
      const otherMonthVal = roundPence(
        otherMerchants.reduce((s, m) => s + (m.byMonth.get(mk) ?? 0), 0)
      );
      point.m_other = otherMonthVal;
      monthTotal += otherMonthVal;
    }

    point.total = roundPence(monthTotal);
    return point;
  });

  return {
    months,
    merchants,
    activeCategories,
    totalSpend: roundedTotalSpend,
    monthCount: windowMonths.length,
  };
}




