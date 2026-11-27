import { jsPDF } from 'jspdf';
import {
  CATEGORIES,
  CURRENCY_CONFIG,
  getTransactionDisplayAmount,
  type CapPaceAlert,
  type CategoryId,
  type CurrencyCode,
  type DebtAccount,
  type ExchangeRateTable,
  type IsaPlannerSettings,
  type MonthlyBreakdown,
  type RecurringItem,
  type SavingsRecommendation,
  type SmartTagSummary,
  type SpendingClass,
  type SpendingTrendProjectionSummary,
  type Transaction,
  type UpcomingBillsSummary,
} from '../types/finance';
import {
  analyzeLedgerSmartTags,
  computeProjectedCapAlerts,
  computeSubscriptionAnnualProjection,
  computeWealthProjections,
  formatMonthLabel,
  simulateDebtStrategies,
  type AnalyticsResult,
  type DebtSimulationResult,
  type SubscriptionAnnualProjection,
} from './analyticsEngine';

export type ReportCadence = 'monthly' | 'quarterly';
export type PdfPaperFormat = 'a4' | 'letter';

const QUARTER_MONTH_RANGES: Record<number, string> = {
  1: 'Jan-Mar',
  2: 'Apr-Jun',
  3: 'Jul-Sep',
  4: 'Oct-Dec',
};

export function getQuarterKeyFromDate(dateStr: string): string | null {
  if (!dateStr || dateStr.length < 7) return null;
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  const q = Math.ceil(month / 3);
  return `${year}-Q${q}`;
}

export function formatQuarterLabel(quarterKey: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarterKey);
  if (!match) return quarterKey;
  const year = match[1];
  const qNum = parseInt(match[2], 10);
  const range = QUARTER_MONTH_RANGES[qNum] ?? '';
  return range ? `Q${qNum} ${year} (${range})` : `Q${qNum} ${year}`;
}

export function getAvailableQuarters(transactions: Transaction[]): string[] {
  const set = new Set<string>();
  for (const tx of transactions) {
    const qk = getQuarterKeyFromDate(tx.date);
    if (qk) set.add(qk);
  }
  return Array.from(set).sort().reverse();
}

export interface ReportCategoryRow {
  categoryId: CategoryId;
  label: string;
  spendingClass: SpendingClass;
  amount: number;
  transactionCount: number;
  sharePct: number;
  monthlyCap: number | null;
  variance: number | null; // positive = over cap
}

export interface ReportMerchantRow {
  merchant: string;
  categoryLabel: string;
  count: number;
  total: number;
  sharePct: number;
}

export interface ReportLedgerSummary {
  totalRows: number;
  inflowCount: number;
  outflowCount: number;
  savingsTransferCount: number;
  avgOutflowTicket: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  topMerchants: ReportMerchantRow[];
  monthlyLedgerSeries: MonthlyBreakdown[];
}

export interface MonthlyReportData {
  periodKey: string; // 'YYYY-MM', 'YYYY-Q[1-4]', or 'summary'
  periodLabel: string;
  cadence: ReportCadence;
  isSingleMonth: boolean;
  isQuarterly: boolean;
  periodCapLabel: string;
  monthCountRepresented: number;
  baselineMonthCount: number;
  excludedPartialMonthLabel: string | null;
  income: number;
  essential: number;
  nonEssential: number;
  totalSpending: number;
  savingsTransfer: number;
  netCashFlow: number;
  savingsRatePct: number;
  essentialSharePct: number;
  nonEssentialSharePct: number;
  vsAverageSpendingDeltaPct: number | null;
  categories: ReportCategoryRow[];
  recommendations: SavingsRecommendation[];
  cancelableSubscriptions: RecurringItem[];
  topTransactions: Transaction[];
  ledgerTransactions: Transaction[];
  ledgerSummary: ReportLedgerSummary;
  smartTags: SmartTagSummary;
  spendingTrendProjection: SpendingTrendProjectionSummary;
  subscriptionAnnualProjection: SubscriptionAnnualProjection;
  capPaceAlerts: CapPaceAlert[];
  upcomingBills: UpcomingBillsSummary;
  potentialMonthlySavings: number;
  potentialAnnualSavings: number;
  fiveYearCashIsaProjection: number;
  savingsVsDebt: DebtSimulationResult | null;
  isaCashRatePct: number;
  transactionCount: number;
}

export interface PdfReportOptions {
  currency: CurrencyCode;
  exchangeRates?: Partial<ExchangeRateTable>;
  paperFormat?: PdfPaperFormat;
  includeAnalyticalFindings: boolean;
  includeLedgerSummary: boolean;
  includeCategoryBreakdown: boolean;
  includeRecommendations: boolean;
  includeSubscriptions: boolean;
  includeSavingsVsDebt: boolean;
  includeTopTransactions: boolean;
}

function roundPence(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Formats currency safely for jsPDF built-in Helvetica (WinAnsiEncoding).
 * GBP (£) and USD ($) are native in WinAnsi; EUR/JPY/CHF use clean ASCII prefixes.
 */
function formatPdfMoney(amount: number, currency: CurrencyCode, decimals = 0): string {
  const effectiveDecimals = currency === 'JPY' ? 0 : decimals;
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-GB', {
    minimumFractionDigits: effectiveDecimals,
    maximumFractionDigits: effectiveDecimals,
  });
  const prefix =
    currency === 'EUR'
      ? 'EUR '
      : currency === 'JPY'
        ? 'JPY '
        : CURRENCY_CONFIG[currency].symbol;
  return amount < 0 ? `-${prefix}${formatted}` : `${prefix}${formatted}`;
}

/**
 * Retains pence precision whenever rounding to whole units would mask a non-zero
 * amount or warning delta (e.g. £0.40 over cap stays £0.40 instead of £0).
 */
function formatPdfPreciseMoney(
  amount: number,
  currency: CurrencyCode,
  forcePence = false
): string {
  const needsPence =
    forcePence ||
    (amount !== 0 && Math.abs(amount) < 1) ||
    (Math.abs(amount - Math.round(amount)) >= 0.005 && Math.abs(amount) < 100);
  return formatPdfMoney(amount, currency, needsPence ? 2 : 0);
}

/**
 * Strips characters outside Latin-1/WinAnsi so jsPDF built-in Helvetica renders cleanly.
 */
function sanitizePdfText(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\xFF]/g, '');
}

export function buildMonthlyReportData(
  transactions: Transaction[],
  analytics: AnalyticsResult,
  categoryCaps: Partial<Record<CategoryId, number>> | undefined,
  isaSettings: IsaPlannerSettings,
  periodKey: string,
  currency: CurrencyCode = 'GBP',
  exchangeRates?: Partial<ExchangeRateTable>,
  debts: DebtAccount[] = []
): MonthlyReportData {
  const caps = categoryCaps ?? {};
  const isQuarterly = /^\d{4}-Q[1-4]$/.test(periodKey);
  const isSingleMonth = !isQuarterly && periodKey !== 'summary';
  const cadence: ReportCadence = isQuarterly ? 'quarterly' : 'monthly';

  const scopedTxs = isQuarterly
    ? transactions.filter((t) => getQuarterKeyFromDate(t.date) === periodKey)
    : isSingleMonth
      ? transactions.filter((t) => t.date.startsWith(periodKey))
      : transactions;

  const distinctMonthKeys = Array.from(
    new Set(scopedTxs.map((t) => t.date.slice(0, 7)).filter((mk) => mk.length === 7))
  ).sort();
  const distinctMonthsInScope = distinctMonthKeys.length;

  const monthsRepresented = isQuarterly
    ? Math.max(distinctMonthsInScope, 1)
    : isSingleMonth
      ? 1
      : Math.max(analytics.baselineMonthCount || analytics.monthCount, 1);

  let income = 0;
  let essential = 0;
  let nonEssential = 0;
  let savingsTransfer = 0;
  let inflowCount = 0;
  let outflowCount = 0;
  let savingsTransferCount = 0;

  const catMap = new Map<CategoryId, { amount: number; count: number }>();
  const merchMap = new Map<
    string,
    { merchant: string; categoryLabel: string; count: number; total: number }
  >();
  const expenseTxs: Transaction[] = [];

  for (const tx of scopedTxs) {
    const convertedAbs = Math.abs(
      getTransactionDisplayAmount(tx, currency, exchangeRates)
    );
    if (tx.spendingClass === 'income' || tx.amount > 0) {
      income += convertedAbs;
      inflowCount += 1;
    } else if (tx.spendingClass === 'savings') {
      savingsTransfer += convertedAbs;
      savingsTransferCount += 1;
    } else {
      outflowCount += 1;
      if (tx.spendingClass === 'essential') {
        essential += convertedAbs;
      } else {
        nonEssential += convertedAbs;
      }
      expenseTxs.push(tx);

      const prev = catMap.get(tx.category) ?? { amount: 0, count: 0 };
      prev.amount += convertedAbs;
      prev.count += 1;
      catMap.set(tx.category, prev);

      const mKey = tx.merchant.trim().toLowerCase();
      const prevMerch = merchMap.get(mKey) ?? {
        merchant: tx.merchant,
        categoryLabel: CATEGORIES[tx.category]?.label ?? tx.category,
        count: 0,
        total: 0,
      };
      prevMerch.count += 1;
      prevMerch.total += convertedAbs;
      merchMap.set(mKey, prevMerch);
    }
  }

  // Monthly & Quarterly reports present actual period totals; 'summary' uses completed baseline averages
  const useAnalyticsBaseline = !isSingleMonth && !isQuarterly;
  const divisor = isSingleMonth || isQuarterly ? 1 : monthsRepresented;
  const capMultiplier = isQuarterly ? monthsRepresented : 1;

  const displayIncome = roundPence(
    useAnalyticsBaseline ? analytics.avgMonthlyIncome : income / divisor
  );
  const displayEssential = roundPence(
    useAnalyticsBaseline ? analytics.avgMonthlyEssential : essential / divisor
  );
  const displayNonEssential = roundPence(
    useAnalyticsBaseline ? analytics.avgMonthlyNonEssential : nonEssential / divisor
  );
  const displayTotalSpending = roundPence(displayEssential + displayNonEssential);
  const displaySavingsTransfer = roundPence(
    useAnalyticsBaseline ? analytics.avgMonthlySavingsTransfer : savingsTransfer / divisor
  );
  const netCashFlow = roundPence(displayIncome - displayTotalSpending);
  const savingsRatePct =
    displayIncome > 0 ? (netCashFlow / displayIncome) * 100 : 0;
  const essentialSharePct =
    displayTotalSpending > 0
      ? (displayEssential / displayTotalSpending) * 100
      : 0;
  const nonEssentialSharePct =
    displayTotalSpending > 0
      ? (displayNonEssential / displayTotalSpending) * 100
      : 0;

  const effectiveMonthlySpend = isQuarterly
    ? displayTotalSpending / monthsRepresented
    : displayTotalSpending;

  const vsAverageSpendingDeltaPct =
    (isSingleMonth || isQuarterly) && analytics.avgMonthlySpending > 0
      ? ((effectiveMonthlySpend - analytics.avgMonthlySpending) /
          analytics.avgMonthlySpending) *
        100
      : null;

  const baselineCatAvgById = new Map(
    analytics.categoryDrains.map((c) => [c.categoryId, c.monthlyAverage])
  );

  const categories: ReportCategoryRow[] = Array.from(catMap.entries())
    .map(([categoryId, data]) => {
      const meta = CATEGORIES[categoryId];
      const normalizedAmount = roundPence(
        useAnalyticsBaseline
          ? (baselineCatAvgById.get(categoryId) ?? data.amount / divisor)
          : data.amount / divisor
      );
      const rawCap = caps[categoryId];
      const periodCap =
        typeof rawCap === 'number' && rawCap > 0
          ? roundPence(rawCap * capMultiplier)
          : null;
      return {
        categoryId,
        label: meta.label,
        spendingClass: meta.defaultClass,
        amount: normalizedAmount,
        transactionCount: data.count,
        sharePct:
          displayTotalSpending > 0
            ? (normalizedAmount / displayTotalSpending) * 100
            : 0,
        monthlyCap: periodCap,
        variance: periodCap !== null ? roundPence(normalizedAmount - periodCap) : null,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const cancelableSubscriptions = analytics.recurringItems.filter(
    (item) =>
      item.subscriptionClass === 'cancelable' ||
      item.action === 'cancel' ||
      item.action === 'downgrade'
  );

  const topTransactions = [...expenseTxs]
    .sort(
      (a, b) =>
        Math.abs(getTransactionDisplayAmount(b, currency, exchangeRates)) -
        Math.abs(getTransactionDisplayAmount(a, currency, exchangeRates))
    )
    .slice(0, 10);

  const ledgerTransactions = [...scopedTxs].sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  const totalPeriodOutflow = essential + nonEssential;
  const topMerchants: ReportMerchantRow[] = Array.from(merchMap.values())
    .map((m) => ({
      merchant: m.merchant,
      categoryLabel: m.categoryLabel,
      count: m.count,
      total: roundPence(m.total),
      sharePct: totalPeriodOutflow > 0 ? (m.total / totalPeriodOutflow) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const scopedMonthKeySet = new Set(distinctMonthKeys);
  const monthlyLedgerSeries = isSingleMonth
    ? analytics.monthlySeries.slice(-6)
    : analytics.monthlySeries.filter((m) => scopedMonthKeySet.has(m.monthKey));

  const sortedDates = scopedTxs
    .map((t) => t.date)
    .filter(Boolean)
    .sort();
  const dateRangeStart = sortedDates[0] ?? null;
  const dateRangeEnd = sortedDates[sortedDates.length - 1] ?? null;

  const ledgerSummary: ReportLedgerSummary = {
    totalRows: scopedTxs.length,
    inflowCount,
    outflowCount,
    savingsTransferCount,
    avgOutflowTicket:
      outflowCount > 0 ? roundPence(totalPeriodOutflow / outflowCount) : 0,
    dateRangeStart,
    dateRangeEnd,
    topMerchants,
    monthlyLedgerSeries,
  };

  const smartTags = analyzeLedgerSmartTags(scopedTxs, currency, exchangeRates);

  const potentialMonthlySavings = roundPence(analytics.totalRecommendedMonthlySavings);
  const potentialAnnualSavings = roundPence(potentialMonthlySavings * 12);

  const isa5Yr = computeWealthProjections(potentialMonthlySavings, {
    ...isaSettings,
    horizonYears: 5,
  });

  const activeDebts = debts.filter((d) => d.balance > 0);
  const extraMonthlyBudget = Math.max(
    0,
    Math.round(analytics.avgMonthlySurplus + analytics.totalRecommendedMonthlySavings)
  );
  const savingsVsDebt =
    activeDebts.length > 0
      ? simulateDebtStrategies(activeDebts, extraMonthlyBudget, isaSettings.cashIsaRate)
      : null;

  const subscriptionAnnualProjection = computeSubscriptionAnnualProjection(
    analytics.recurringItems
  );
  const capPaceAlerts = computeProjectedCapAlerts(
    transactions,
    caps,
    new Date(),
    currency,
    exchangeRates
  );

  return {
    periodKey,
    periodLabel: isQuarterly
      ? formatQuarterLabel(periodKey)
      : isSingleMonth
        ? formatMonthLabel(periodKey)
        : `Monthly Average (${analytics.dateRangeLabel})`,
    cadence,
    isSingleMonth,
    isQuarterly,
    periodCapLabel: isQuarterly
      ? monthsRepresented === 3
        ? 'Quarterly Cap'
        : `${monthsRepresented}M Cap`
      : 'Monthly Cap',
    monthCountRepresented: monthsRepresented,
    baselineMonthCount: analytics.baselineMonthCount,
    excludedPartialMonthLabel: analytics.excludedPartialMonthLabel,
    income: displayIncome,
    essential: displayEssential,
    nonEssential: displayNonEssential,
    totalSpending: displayTotalSpending,
    savingsTransfer: displaySavingsTransfer,
    netCashFlow,
    savingsRatePct,
    essentialSharePct,
    nonEssentialSharePct,
    vsAverageSpendingDeltaPct,
    categories,
    recommendations: analytics.recommendations,
    cancelableSubscriptions,
    topTransactions,
    ledgerTransactions,
    ledgerSummary,
    smartTags,
    spendingTrendProjection: analytics.spendingTrendProjection,
    subscriptionAnnualProjection,
    capPaceAlerts,
    upcomingBills: analytics.upcomingBills,
    potentialMonthlySavings,
    potentialAnnualSavings,
    fiveYearCashIsaProjection: roundPence(isa5Yr.finalCashIsa),
    savingsVsDebt,
    isaCashRatePct: isaSettings.cashIsaRate,
    transactionCount: scopedTxs.length,
  };
}

export function generateMonthlyPdfDocument(
  report: MonthlyReportData,
  options: PdfReportOptions
): jsPDF {
  const { currency } = options;
  const paperFormat: PdfPaperFormat = options.paperFormat ?? 'a4';
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: paperFormat,
    compress: true,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 15;
  const contentWidth = pageWidth - marginX * 2;
  const bottomLimit = pageHeight - 19;

  let y = 17;

  const drawHairline = (yPos: number) => {
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(marginX, yPos, pageWidth - marginX, yPos);
  };

  const startContinuationPage = () => {
    doc.addPage();
    y = 14;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 118, 110);
    doc.text('Clearledger', marginX, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      sanitizePdfText(`Analytical Findings & Ledger Summary  |  ${report.periodLabel}`),
      pageWidth - marginX,
      y,
      { align: 'right' }
    );
    y += 3;
    drawHairline(y);
    y += 6.5;
  };

  const ensureSpace = (neededMm: number, onNewPage?: () => void) => {
    if (y + neededMm > bottomLimit) {
      startContinuationPage();
      if (onNewPage) onNewPage();
    }
  };

  const drawSectionHeading = (title: string, subtitle?: string) => {
    ensureSpace(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(sanitizePdfText(title), marginX, y);
    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(100, 116, 139);
      doc.text(sanitizePdfText(subtitle), pageWidth - marginX, y, { align: 'right' });
    }
    y += 2.8;
    drawHairline(y);
    y += 5.2;
  };

  // Document Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text('Clearledger', marginX, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(15, 118, 110);
  doc.text(
    report.isQuarterly
      ? 'Quarterly Analytical & Ledger Report'
      : 'Analytical Findings & Ledger Report',
    pageWidth - marginX,
    y - 1,
    { align: 'right' }
  );

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  doc.text(
    sanitizePdfText(
      `${report.isQuarterly ? 'Quarterly Period' : 'Report Period'}: ${report.periodLabel}`
    ),
    marginX,
    y
  );

  const generatedDate = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  doc.setFontSize(8.3);
  doc.setTextColor(100, 116, 139);
  doc.text(
    sanitizePdfText(
      `Generated ${generatedDate}  |  ${report.transactionCount} ledger rows  |  ${paperFormat.toUpperCase()}`
    ),
    pageWidth - marginX,
    y,
    { align: 'right' }
  );

  y += 4;
  doc.setDrawColor(15, 118, 110);
  doc.setLineWidth(0.65);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 7.5;

  // Executive KPI Strip (4 columns)
  const kpis = [
    {
      label: report.isQuarterly
        ? 'Quarterly Income'
        : report.isSingleMonth
          ? 'Monthly Income'
          : 'Avg Monthly Income',
      value: formatPdfPreciseMoney(report.income, currency),
      note: report.isQuarterly
        ? `${formatPdfPreciseMoney(report.income / report.monthCountRepresented, currency)}/mo avg`
        : `${report.ledgerSummary.inflowCount} inflow entries`,
    },
    {
      label: report.isQuarterly
        ? 'Quarterly Spending'
        : report.isSingleMonth
          ? 'Total Spending'
          : 'Avg Monthly Spend',
      value: formatPdfPreciseMoney(report.totalSpending, currency),
      note:
        report.vsAverageSpendingDeltaPct !== null
          ? `${report.vsAverageSpendingDeltaPct >= 0 ? '+' : ''}${report.vsAverageSpendingDeltaPct.toFixed(1)}% vs baseline avg`
          : `${report.essentialSharePct.toFixed(0)}% essential`,
    },
    {
      label: report.isQuarterly ? 'Quarterly Non-Essential' : 'Non-Essential Spend',
      value: formatPdfPreciseMoney(report.nonEssential, currency),
      note: `${report.nonEssentialSharePct.toFixed(1)}% of total spend`,
    },
    {
      label: report.isQuarterly ? 'Quarterly Net Surplus' : 'Net Cash Surplus',
      value: formatPdfPreciseMoney(report.netCashFlow, currency),
      note: `${report.savingsRatePct.toFixed(1)}% savings rate`,
    },
  ];

  const colGap = 3.5;
  const boxW = (contentWidth - colGap * 3) / 4;
  const boxH = 21;

  kpis.forEach((kpi, idx) => {
    const x = marginX + idx * (boxW + colGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, boxW, boxH, 1.8, 1.8, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    doc.text(sanitizePdfText(kpi.label), x + 2.8, y + 5.2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.8);
    doc.setTextColor(15, 23, 42);
    doc.text(sanitizePdfText(kpi.value), x + 2.8, y + 12.6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(71, 85, 105);
    doc.text(sanitizePdfText(kpi.note), x + 2.8, y + 17.8);
  });

  y += boxH + 6.5;

  // Essential vs Non-Essential proportional bar
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(71, 85, 105);
  doc.text(
    sanitizePdfText(
      `Essential: ${formatPdfPreciseMoney(report.essential, currency)} (${report.essentialSharePct.toFixed(1)}%)`
    ),
    marginX,
    y
  );
  doc.text(
    sanitizePdfText(
      `Non-Essential: ${formatPdfPreciseMoney(report.nonEssential, currency)} (${report.nonEssentialSharePct.toFixed(1)}%)`
    ),
    pageWidth - marginX,
    y,
    { align: 'right' }
  );
  y += 2.3;

  const barH = 3.2;
  const essW =
    report.totalSpending > 0
      ? (report.essential / report.totalSpending) * contentWidth
      : contentWidth * 0.5;
  doc.setFillColor(51, 65, 85);
  doc.rect(marginX, y, Math.max(essW, 0), barH, 'F');
  doc.setFillColor(217, 119, 6);
  doc.rect(marginX + essW, y, Math.max(contentWidth - essW, 0), barH, 'F');
  y += barH + 8;

  // 1. Analytical Findings & Next-Month Spending Forecast
  if (options.includeAnalyticalFindings) {
    const proj = report.spendingTrendProjection;
    drawSectionHeading(
      'Analytical Findings & Spending Trend Forecast',
      `Forecast for ${proj.nextMonthLabel}  |  ${proj.monthsAnalyzed} completed baseline mo`
    );

    // Baseline Integrity Banner
    const baselineNote = proj.excludedPartialMonthLabel
      ? `Baseline Integrity: Partial trailing month (${proj.excludedPartialMonthLabel}) excluded from baseline averages and forecasts to prevent low-bias warnings. Projected total for ${proj.nextMonthLabel}: ${formatPdfPreciseMoney(proj.totalProjectedNextMonth, currency, true)} (${proj.projectedOverLimitCount} over cap, ${proj.varianceRiskCount} variance risk).`
      : `Baseline Integrity: ${proj.monthsAnalyzed} completed month${proj.monthsAnalyzed === 1 ? '' : 's'} analyzed using per-category active history windows. Projected total for ${proj.nextMonthLabel}: ${formatPdfPreciseMoney(proj.totalProjectedNextMonth, currency, true)} (${proj.projectedOverLimitCount} over cap, ${proj.varianceRiskCount} variance risk).`;

    const wrappedNote = doc.splitTextToSize(
      sanitizePdfText(baselineNote),
      contentWidth - 6
    ) as string[];
    const noteBoxH = 4.2 + wrappedNote.length * 3.8;
    ensureSpace(noteBoxH + 4);
    doc.setFillColor(240, 253, 250);
    doc.setDrawColor(153, 246, 228);
    doc.setLineWidth(0.25);
    doc.roundedRect(marginX, y, contentWidth, noteBoxH, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(17, 94, 89);
    doc.text(wrappedNote, marginX + 3, y + 4.4);
    y += noteBoxH + 5;

    const projRows = proj.categories.slice(0, 12);
    if (projRows.length > 0) {
      const drawProjectionHeader = () => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(100, 116, 139);
        doc.text('Category', marginX, y);
        doc.text('Obs. Mo', marginX + 60, y, { align: 'right' });
        doc.text('Baseline Avg', marginX + 86, y, { align: 'right' });
        doc.text('Projected', marginX + 114, y, { align: 'right' });
        doc.text('Monthly Cap', marginX + 141, y, { align: 'right' });
        doc.text('Forecast Status', pageWidth - marginX, y, { align: 'right' });
        y += 2.4;
        drawHairline(y);
        y += 4.3;
      };

      ensureSpace(14);
      drawProjectionHeader();

      projRows.forEach((row, idx) => {
        ensureSpace(6.2, drawProjectionHeader);
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(marginX, y - 3.6, contentWidth, 5.4, 'F');
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.2);
        doc.setTextColor(15, 23, 42);
        doc.text(sanitizePdfText(row.label.slice(0, 28)), marginX, y);

        doc.setTextColor(100, 116, 139);
        doc.text(`${row.monthsObserved}m`, marginX + 60, y, { align: 'right' });

        doc.setTextColor(71, 85, 105);
        const showRowPence =
          row.projectedVsLimitDelta !== null &&
          row.projectedVsLimitDelta > 0 &&
          Math.round(row.projectedVsLimitDelta) === 0;
        doc.text(
          formatPdfPreciseMoney(row.historicalMean, currency, showRowPence),
          marginX + 86,
          y,
          { align: 'right' }
        );

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(
          row.riskStatus === 'insufficient_data'
            ? '-'
            : formatPdfPreciseMoney(row.projectedNextMonth, currency, showRowPence),
          marginX + 114,
          y,
          { align: 'right' }
        );

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(
          row.monthlyCap !== null
            ? formatPdfPreciseMoney(row.monthlyCap, currency, showRowPence)
            : '-',
          marginX + 141,
          y,
          { align: 'right' }
        );

        if (row.riskStatus === 'projected_over' && row.projectedVsLimitDelta !== null) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(185, 28, 28);
          doc.text(
            `Over +${formatPdfPreciseMoney(row.projectedVsLimitDelta, currency, showRowPence)}`,
            pageWidth - marginX,
            y,
            { align: 'right' }
          );
        } else if (row.riskStatus === 'variance_risk') {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(180, 83, 9);
          doc.text('Variance Risk', pageWidth - marginX, y, { align: 'right' });
        } else if (row.riskStatus === 'insufficient_data') {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(100, 116, 139);
          doc.text('Insufficient Data', pageWidth - marginX, y, { align: 'right' });
        } else if (row.riskStatus === 'on_track') {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(15, 118, 110);
          doc.text('On Track', pageWidth - marginX, y, { align: 'right' });
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(100, 116, 139);
          doc.text('Uncapped', pageWidth - marginX, y, { align: 'right' });
        }

        y += 5.5;
      });
      y += 3.5;
    }

    // Upcoming Bills (Next 7 Days)
    if (report.upcomingBills.dueSoon.length > 0) {
      ensureSpace(14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.8);
      doc.setTextColor(15, 23, 42);
      doc.text(
        sanitizePdfText(
          `Upcoming Recurring Bills (Next ${report.upcomingBills.windowDays} Days) - Total ${formatPdfMoney(report.upcomingBills.totalDueSoon, currency, 2)}`
        ),
        marginX,
        y
      );
      y += 4.5;

      for (const bill of report.upcomingBills.dueSoon.slice(0, 6)) {
        ensureSpace(5.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.2);
        doc.setTextColor(100, 116, 139);
        doc.text(bill.dueDate, marginX, y);
        doc.setTextColor(15, 23, 42);
        doc.text(sanitizePdfText(bill.merchant.slice(0, 34)), marginX + 24, y);
        doc.setTextColor(71, 85, 105);
        doc.text(sanitizePdfText(bill.categoryLabel.slice(0, 26)), marginX + 94, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(formatPdfMoney(bill.expectedAmount, currency, 2), pageWidth - marginX, y, {
          align: 'right',
        });
        y += 5.2;
      }
      y += 3.5;
    }
  }

  // 2. Category Breakdown Table
  if (options.includeCategoryBreakdown) {
    drawSectionHeading(
      report.isQuarterly
        ? 'Category Spending Breakdown & Quarterly Caps'
        : 'Category Spending Breakdown & Monthly Caps',
      `${report.categories.length} active categories`
    );

    if (report.categories.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.8);
      doc.setTextColor(100, 116, 139);
      doc.text('No spending transactions recorded for this period.', marginX, y);
      y += 8;
    } else {
      const drawCategoryHeader = () => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(100, 116, 139);
        doc.text('Category', marginX, y);
        doc.text('Class', marginX + 62, y);
        doc.text('Tx', marginX + 92, y, { align: 'right' });
        doc.text('Spend', marginX + 117, y, { align: 'right' });
        doc.text(report.periodCapLabel, marginX + 144, y, { align: 'right' });
        doc.text('Status / Share', pageWidth - marginX, y, { align: 'right' });
        y += 2.4;
        drawHairline(y);
        y += 4.3;
      };

      ensureSpace(14);
      drawCategoryHeader();

      report.categories.forEach((row, idx) => {
        ensureSpace(6.2, drawCategoryHeader);
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(marginX, y - 3.6, contentWidth, 5.4, 'F');
        }

        const needsPence =
          row.variance !== null &&
          row.variance > 0 &&
          Math.round(row.variance) === 0;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.3);
        doc.setTextColor(15, 23, 42);
        doc.text(sanitizePdfText(row.label.slice(0, 30)), marginX, y);

        doc.setTextColor(
          row.spendingClass === 'non-essential' ? 180 : 71,
          row.spendingClass === 'non-essential' ? 83 : 85,
          row.spendingClass === 'non-essential' ? 9 : 105
        );
        doc.text(
          row.spendingClass === 'essential' ? 'Essential' : 'Non-Essential',
          marginX + 62,
          y
        );

        doc.setTextColor(100, 116, 139);
        doc.text(String(row.transactionCount), marginX + 92, y, { align: 'right' });

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(
          formatPdfPreciseMoney(row.amount, currency, needsPence),
          marginX + 117,
          y,
          { align: 'right' }
        );

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(
          row.monthlyCap !== null
            ? formatPdfPreciseMoney(row.monthlyCap, currency, needsPence)
            : '-',
          marginX + 144,
          y,
          { align: 'right' }
        );

        if (row.variance !== null && row.variance > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(185, 28, 28);
          doc.text(
            `Over +${formatPdfPreciseMoney(row.variance, currency, needsPence)}`,
            pageWidth - marginX,
            y,
            { align: 'right' }
          );
        } else if (row.variance !== null) {
          doc.setTextColor(15, 118, 110);
          doc.text(
            `Under (${row.sharePct.toFixed(0)}%)`,
            pageWidth - marginX,
            y,
            { align: 'right' }
          );
        } else {
          doc.setTextColor(100, 116, 139);
          doc.text(`${row.sharePct.toFixed(1)}% of spend`, pageWidth - marginX, y, {
            align: 'right',
          });
        }

        y += 5.6;
      });
      y += 4;
    }
  }

  // 3. Ledger Summary, Monthly Cash-Flow & Smart-Tagged Expenses
  if (options.includeLedgerSummary) {
    const ls = report.ledgerSummary;
    const st = report.smartTags;
    const coverage =
      ls.dateRangeStart && ls.dateRangeEnd
        ? `${ls.dateRangeStart} to ${ls.dateRangeEnd}`
        : 'No entries';
    drawSectionHeading('Ledger Summary & Smart-Tagged Activity', coverage);

    // 4-box Ledger & Smart-Tag Strip
    ensureSpace(24);
    const lKpis = [
      {
        label: 'Ledger Entries',
        value: String(ls.totalRows),
        note: `${ls.inflowCount} in / ${ls.outflowCount} out`,
      },
      {
        label: 'Avg Outflow Ticket',
        value: formatPdfMoney(ls.avgOutflowTicket, currency, 2),
        note: `${ls.savingsTransferCount} savings transfers`,
      },
      {
        label: 'Tax Deductible',
        value: formatPdfMoney(st.taxDeductibleTotal, currency, 2),
        note: `${st.taxDeductibleCount} auto-tagged rows`,
      },
      {
        label: 'Expense Claimable',
        value: formatPdfMoney(st.expenseClaimableTotal, currency, 2),
        note: `${st.expenseClaimableCount} auto-tagged rows`,
      },
    ];

    const lBoxH = 19;
    lKpis.forEach((kpi, idx) => {
      const x = marginX + idx * (boxW + colGap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.25);
      doc.roundedRect(x, y, boxW, lBoxH, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.3);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, x + 2.8, y + 5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.8);
      doc.setTextColor(15, 23, 42);
      doc.text(sanitizePdfText(kpi.value), x + 2.8, y + 11.6);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.1);
      doc.setTextColor(71, 85, 105);
      doc.text(sanitizePdfText(kpi.note), x + 2.8, y + 16.4);
    });
    y += lBoxH + 6;

    // Monthly Ledger Cash-Flow Table
    if (ls.monthlyLedgerSeries.length > 0) {
      const drawMonthlyLedgerHeader = () => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(100, 116, 139);
        doc.text('Month', marginX, y);
        doc.text('Income', marginX + 46, y, { align: 'right' });
        doc.text('Essential', marginX + 76, y, { align: 'right' });
        doc.text('Non-Ess.', marginX + 106, y, { align: 'right' });
        doc.text('Total Spend', marginX + 136, y, { align: 'right' });
        doc.text('Net Cash Flow', pageWidth - marginX, y, { align: 'right' });
        y += 2.4;
        drawHairline(y);
        y += 4.3;
      };

      ensureSpace(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.8);
      doc.setTextColor(15, 23, 42);
      doc.text('Monthly Ledger Cash-Flow Summary', marginX, y);
      y += 4.5;
      drawMonthlyLedgerHeader();

      ls.monthlyLedgerSeries.forEach((m, idx) => {
        ensureSpace(6, drawMonthlyLedgerHeader);
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(marginX, y - 3.6, contentWidth, 5.2, 'F');
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.1);
        doc.setTextColor(15, 23, 42);
        doc.text(sanitizePdfText(m.label), marginX, y);

        doc.setTextColor(15, 118, 110);
        doc.text(formatPdfPreciseMoney(m.income, currency), marginX + 46, y, {
          align: 'right',
        });
        doc.setTextColor(71, 85, 105);
        doc.text(formatPdfPreciseMoney(m.essential, currency), marginX + 76, y, {
          align: 'right',
        });
        doc.setTextColor(180, 83, 9);
        doc.text(formatPdfPreciseMoney(m.nonEssential, currency), marginX + 106, y, {
          align: 'right',
        });
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(formatPdfPreciseMoney(m.totalSpending, currency), marginX + 136, y, {
          align: 'right',
        });
        doc.setTextColor(
          m.netCashFlow >= 0 ? 15 : 185,
          m.netCashFlow >= 0 ? 118 : 28,
          m.netCashFlow >= 0 ? 110 : 28
        );
        doc.text(
          `${formatPdfPreciseMoney(m.netCashFlow, currency)} (${m.savingsRate.toFixed(0)}%)`,
          pageWidth - marginX,
          y,
          { align: 'right' }
        );
        y += 5.4;
      });
      y += 4;
    }

    // Top Merchants Concentration Table
    if (ls.topMerchants.length > 0) {
      const drawMerchantHeader = () => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(100, 116, 139);
        doc.text('Top Merchants in Period', marginX, y);
        doc.text('Category', marginX + 66, y);
        doc.text('Tx', marginX + 122, y, { align: 'right' });
        doc.text('Share', marginX + 144, y, { align: 'right' });
        doc.text('Total Outflow', pageWidth - marginX, y, { align: 'right' });
        y += 2.4;
        drawHairline(y);
        y += 4.3;
      };

      ensureSpace(14);
      drawMerchantHeader();

      ls.topMerchants.forEach((m, idx) => {
        ensureSpace(5.8, drawMerchantHeader);
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(marginX, y - 3.6, contentWidth, 5.2, 'F');
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.2);
        doc.setTextColor(15, 23, 42);
        doc.text(sanitizePdfText(m.merchant.slice(0, 32)), marginX, y);
        doc.setTextColor(71, 85, 105);
        doc.text(sanitizePdfText(m.categoryLabel.slice(0, 24)), marginX + 66, y);
        doc.setTextColor(100, 116, 139);
        doc.text(String(m.count), marginX + 122, y, { align: 'right' });
        doc.text(`${m.sharePct.toFixed(1)}%`, marginX + 144, y, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(formatPdfMoney(m.total, currency, 2), pageWidth - marginX, y, {
          align: 'right',
        });
        y += 5.3;
      });
      y += 4;
    }

    // Period Ledger Register (up to 45 chronological rows for clean printability)
    if (report.ledgerTransactions.length > 0) {
      const MAX_LEDGER_ROWS = 45;
      const rowsToRender = report.ledgerTransactions.slice(0, MAX_LEDGER_ROWS);
      const drawRegisterHeader = () => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.6);
        doc.setTextColor(100, 116, 139);
        doc.text('Date', marginX, y);
        doc.text('Merchant', marginX + 23, y);
        doc.text('Category', marginX + 86, y);
        doc.text('Tags', marginX + 132, y);
        doc.text('Amount', pageWidth - marginX, y, { align: 'right' });
        y += 2.3;
        drawHairline(y);
        y += 4.2;
      };

      ensureSpace(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.8);
      doc.setTextColor(15, 23, 42);
      doc.text(
        sanitizePdfText(
          `Period Ledger Register (${rowsToRender.length}${report.ledgerTransactions.length > MAX_LEDGER_ROWS ? ` of ${report.ledgerTransactions.length}` : ''} entries)`
        ),
        marginX,
        y
      );
      y += 4.5;
      drawRegisterHeader();

      rowsToRender.forEach((tx, idx) => {
        ensureSpace(5.4, drawRegisterHeader);
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(marginX, y - 3.4, contentWidth, 4.9, 'F');
        }
        const signedAmt = getTransactionDisplayAmount(
          tx,
          currency,
          options.exchangeRates
        );
        const smartMatches = st.byTransactionId[tx.id] ?? [];
        const tagLabel =
          smartMatches.length > 0
            ? smartMatches
                .map((m) => (m.tag === 'tax_deductible' ? 'Tax' : 'Claim'))
                .join(', ')
            : '-';

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.8);
        doc.setTextColor(100, 116, 139);
        doc.text(tx.date, marginX, y);

        doc.setTextColor(15, 23, 42);
        doc.text(sanitizePdfText(tx.merchant.slice(0, 30)), marginX + 23, y);

        doc.setTextColor(71, 85, 105);
        doc.text(
          sanitizePdfText((CATEGORIES[tx.category]?.label ?? tx.category).slice(0, 22)),
          marginX + 86,
          y
        );

        doc.setTextColor(
          smartMatches.length > 0 ? 15 : 148,
          smartMatches.length > 0 ? 118 : 163,
          smartMatches.length > 0 ? 110 : 184
        );
        doc.text(tagLabel, marginX + 132, y);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(
          signedAmt >= 0 ? 15 : 15,
          signedAmt >= 0 ? 118 : 23,
          signedAmt >= 0 ? 110 : 42
        );
        doc.text(formatPdfMoney(signedAmt, currency, 2), pageWidth - marginX, y, {
          align: 'right',
        });
        y += 5;
      });
      y += 4;
    }
  }

  // 4. Potential Savings Recommendations
  if (options.includeRecommendations) {
    drawSectionHeading(
      'Potential Savings Recommendations',
      `Unlock ${formatPdfPreciseMoney(report.potentialMonthlySavings, currency)}/mo (${formatPdfPreciseMoney(report.potentialAnnualSavings, currency)}/yr)`
    );

    ensureSpace(16);
    doc.setFillColor(240, 253, 250);
    doc.setDrawColor(153, 246, 228);
    doc.setLineWidth(0.25);
    doc.roundedRect(marginX, y, contentWidth, 11.5, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(17, 94, 89);
    doc.text(
      sanitizePdfText(
        `Active Cut Plan: ${formatPdfPreciseMoney(report.potentialMonthlySavings, currency)}/mo  |  12-Month Total: ${formatPdfPreciseMoney(report.potentialAnnualSavings, currency)}  |  5-Year Cash ISA: ${formatPdfPreciseMoney(report.fiveYearCashIsaProjection, currency)}`
      ),
      marginX + 3.2,
      y + 7.2
    );
    y += 15.5;

    if (report.recommendations.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text('No automated category reduction targets flagged.', marginX, y);
      y += 8;
    } else {
      for (const rec of report.recommendations) {
        const monthlySaving = rec.currentMonthly * (rec.activeCutPct / 100);
        const rationaleLines = doc.splitTextToSize(
          sanitizePdfText(rec.rationale),
          contentWidth - 38
        ) as string[];
        const blockHeight = 7 + rationaleLines.length * 3.9;
        ensureSpace(blockHeight + 3);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.8);
        doc.setTextColor(15, 23, 42);
        doc.text(
          sanitizePdfText(`${rec.enabled ? '[Active]' : '[Optional]'} ${rec.title}`),
          marginX,
          y
        );

        doc.setTextColor(
          rec.enabled ? 15 : 100,
          rec.enabled ? 118 : 116,
          rec.enabled ? 110 : 139
        );
        doc.text(
          `-${rec.activeCutPct}% (${formatPdfPreciseMoney(monthlySaving, currency)}/mo)`,
          pageWidth - marginX,
          y,
          { align: 'right' }
        );
        y += 4.2;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(71, 85, 105);
        doc.text(rationaleLines, marginX, y);
        y += rationaleLines.length * 3.9 + 3;
      }
    }
    y += 2;
  }

  // 5. 12-Month Recurring Expenditure Projection & Cancelable Subscriptions
  if (
    options.includeSubscriptions &&
    (report.cancelableSubscriptions.length > 0 ||
      report.subscriptionAnnualProjection.itemCount > 0)
  ) {
    const subProj = report.subscriptionAnnualProjection;
    drawSectionHeading(
      '12-Month Recurring Subscriptions & Projection',
      `${subProj.horizonLabel} | ${subProj.itemCount} detected habit${subProj.itemCount === 1 ? '' : 's'}`
    );

    if (subProj.itemCount > 0) {
      ensureSpace(18);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.25);
      doc.roundedRect(marginX, y, contentWidth, 13.5, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(15, 23, 42);
      doc.text(
        sanitizePdfText(
          `Projected 12M Total: ${formatPdfMoney(subProj.totalAnnualBaseline, currency, 2)}  |  Essential: ${formatPdfMoney(subProj.essentialAnnual, currency, 2)}  |  Cancelable: ${formatPdfMoney(subProj.cancelableAnnual, currency, 2)}`
        ),
        marginX + 3.2,
        y + 5.5
      );
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.6);
      doc.setTextColor(71, 85, 105);
      const driftSummary =
        subProj.priceHikeDriftAnnual > 0
          ? `  |  Price-hike drift risk: +${formatPdfMoney(subProj.priceHikeDriftAnnual, currency, 2)}/yr (${subProj.hikedCount} hiked)`
          : '';
      doc.text(
        sanitizePdfText(
          `Lean 12M commitment if cancelable habits cut: ${formatPdfMoney(subProj.optimizedAnnual, currency, 2)} (${formatPdfMoney(subProj.optimizedAnnual / 12, currency, 2)}/mo)${driftSummary}`
        ),
        marginX + 3.2,
        y + 10.6
      );
      y += 17.5;
    }

    if (report.cancelableSubscriptions.length > 0) {
      const drawSubHeader = () => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.8);
        doc.setTextColor(100, 116, 139);
        doc.text('Merchant', marginX, y);
        doc.text('Category', marginX + 62, y);
        doc.text('Action', marginX + 110, y);
        doc.text('Current / mo', marginX + 145, y, { align: 'right' });
        doc.text('Annual Saving', pageWidth - marginX, y, { align: 'right' });
        y += 2.4;
        drawHairline(y);
        y += 4.3;
      };

      ensureSpace(14);
      drawSubHeader();

      report.cancelableSubscriptions.forEach((sub, idx) => {
        ensureSpace(6.2, drawSubHeader);
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(marginX, y - 3.5, contentWidth, 5.2, 'F');
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.3);
        doc.setTextColor(15, 23, 42);
        doc.text(sanitizePdfText(sub.merchant.slice(0, 30)), marginX, y);

        doc.setTextColor(100, 116, 139);
        doc.text(sanitizePdfText(sub.categoryLabel.slice(0, 24)), marginX + 62, y);

        doc.setTextColor(180, 83, 9);
        doc.text(
          sub.action === 'cancel'
            ? 'Cancel'
            : sub.action === 'downgrade'
              ? 'Negotiate (-35%)'
              : 'Review',
          marginX + 110,
          y
        );

        doc.setTextColor(71, 85, 105);
        doc.text(formatPdfMoney(sub.monthlyCost, currency, 2), marginX + 145, y, {
          align: 'right',
        });

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 118, 110);
        doc.text(
          formatPdfPreciseMoney(sub.potentialMonthlySaving * 12, currency),
          pageWidth - marginX,
          y,
          { align: 'right' }
        );
        y += 5.6;
      });
      y += 4;
    }
  }

  // 6. Savings vs. Debt Payoff Comparison Table
  if (options.includeSavingsVsDebt) {
    const sim = report.savingsVsDebt;
    drawSectionHeading(
      'Savings vs. Debt Payoff Comparison',
      sim
        ? `${formatPdfPreciseMoney(sim.totalStartingDebt, currency)} debt @ ${sim.weightedAvgApr.toFixed(1)}% avg APR | ${sim.horizonMonths}M horizon`
        : 'Debt strategy projection'
    );

    if (!sim) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(
        'No active debt accounts recorded. Add debts in the Debt tab to compare Avalanche, Snowball, and Cash ISA paths.',
        marginX,
        y
      );
      y += 8;
    } else {
      ensureSpace(38);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.25);
      doc.roundedRect(marginX, y, contentWidth, 11, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(
        sanitizePdfText(
          `Extra Monthly Budget: ${formatPdfPreciseMoney(sim.extraMonthlyBudget, currency)}/mo  |  Min Payments: ${formatPdfPreciseMoney(sim.totalMinimumMonthly, currency)}/mo  |  Cash ISA Rate: ${report.isaCashRatePct.toFixed(1)}% AER`
        ),
        marginX + 3.2,
        y + 7
      );
      y += 15;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(100, 116, 139);
      doc.text('Strategy', marginX, y);
      doc.text('Debt-Free Date', marginX + 54, y);
      doc.text('Total Interest', marginX + 104, y, { align: 'right' });
      doc.text('Ending Debt', marginX + 129, y, { align: 'right' });
      doc.text('Cash ISA', marginX + 153, y, { align: 'right' });
      doc.text('Net Position', pageWidth - marginX, y, { align: 'right' });
      y += 2.4;
      drawHairline(y);
      y += 4.6;

      const rows = [
        {
          name: 'Debt Avalanche (Highest APR)',
          outcome: sim.avalanche,
          accent: true,
        },
        {
          name: 'Debt Snowball (Smallest Bal)',
          outcome: sim.snowball,
          accent: false,
        },
        {
          name: `Savings Path (Cash ISA ${report.isaCashRatePct.toFixed(1)}%)`,
          outcome: sim.savingsPath,
          accent: false,
        },
      ];

      for (const r of rows) {
        ensureSpace(6.8);
        doc.setFont('helvetica', r.accent ? 'bold' : 'normal');
        doc.setFontSize(8.2);
        doc.setTextColor(r.accent ? 15 : 30, r.accent ? 118 : 41, r.accent ? 110 : 59);
        doc.text(sanitizePdfText(r.name), marginX, y);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(sanitizePdfText(r.outcome.debtFreeDateLabel), marginX + 54, y);

        doc.setTextColor(180, 83, 9);
        doc.text(formatPdfPreciseMoney(r.outcome.totalInterestPaid, currency), marginX + 104, y, {
          align: 'right',
        });

        doc.setTextColor(71, 85, 105);
        doc.text(formatPdfPreciseMoney(r.outcome.finalDebtRemaining, currency), marginX + 129, y, {
          align: 'right',
        });

        doc.setTextColor(15, 118, 110);
        doc.text(formatPdfPreciseMoney(r.outcome.finalIsaSavings, currency), marginX + 153, y, {
          align: 'right',
        });

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(
          r.outcome.finalNetPosition >= 0 ? 15 : 185,
          r.outcome.finalNetPosition >= 0 ? 118 : 28,
          r.outcome.finalNetPosition >= 0 ? 110 : 28
        );
        doc.text(formatPdfPreciseMoney(r.outcome.finalNetPosition, currency), pageWidth - marginX, y, {
          align: 'right',
        });
        y += 6;
      }

      y += 1.5;
      ensureSpace(12);
      const netAdv = sim.netAdvantageAvalancheVsSavingsPath;
      const takeawayText =
        netAdv >= 0
          ? `Key Takeaway: Debt Avalanche finishes ${sim.monthsSavedAvalancheVsMinimum} months faster than minimums, saves ${formatPdfPreciseMoney(sim.interestSavedAvalancheVsMinimum, currency)} in interest, and beats the Cash ISA savings path by +${formatPdfPreciseMoney(netAdv, currency)} net position.`
          : `Key Takeaway: Because your Cash ISA rate exceeds your weighted debt APR, the Savings Path edges out Debt Avalanche by +${formatPdfPreciseMoney(Math.abs(netAdv), currency)} net position over ${sim.horizonMonths} months.`;

      const wrappedTakeaway = doc.splitTextToSize(
        sanitizePdfText(takeawayText),
        contentWidth - 6.5
      ) as string[];
      const boxHeight = 4 + wrappedTakeaway.length * 3.9;
      doc.setFillColor(240, 253, 250);
      doc.setDrawColor(153, 246, 228);
      doc.setLineWidth(0.25);
      doc.roundedRect(marginX, y, contentWidth, boxHeight, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(17, 94, 89);
      doc.text(wrappedTakeaway, marginX + 3.2, y + 4.6);
      y += boxHeight + 5;
    }
  }

  // 7. Largest Outgoing Transactions
  if (options.includeTopTransactions && report.topTransactions.length > 0) {
    drawSectionHeading(
      'Largest Outgoing Transactions',
      `Top ${report.topTransactions.length} expenses in period`
    );

    const drawTopTxHeader = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(100, 116, 139);
      doc.text('Date', marginX, y);
      doc.text('Merchant', marginX + 25, y);
      doc.text('Category', marginX + 94, y);
      doc.text('Amount', pageWidth - marginX, y, { align: 'right' });
      y += 2.4;
      drawHairline(y);
      y += 4.3;
    };

    ensureSpace(14);
    drawTopTxHeader();

    report.topTransactions.forEach((tx, idx) => {
      ensureSpace(6, drawTopTxHeader);
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(marginX, y - 3.5, contentWidth, 5.1, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.3);
      doc.setTextColor(100, 116, 139);
      doc.text(tx.date, marginX, y);

      doc.setTextColor(15, 23, 42);
      doc.text(sanitizePdfText(tx.merchant.slice(0, 34)), marginX + 25, y);

      doc.setTextColor(71, 85, 105);
      doc.text(sanitizePdfText(CATEGORIES[tx.category].label.slice(0, 28)), marginX + 94, y);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      const displayAmt = Math.abs(
        getTransactionDisplayAmount(tx, currency, options.exchangeRates)
      );
      const txNativeCurr = tx.currency ?? currency;
      const amtText =
        txNativeCurr !== currency
          ? `${formatPdfMoney(displayAmt, currency, 2)} (${formatPdfMoney(Math.abs(tx.amount), txNativeCurr, 2)})`
          : formatPdfMoney(displayAmt, currency, 2);
      doc.text(sanitizePdfText(amtText), pageWidth - marginX, y, {
        align: 'right',
      });
      y += 5.5;
    });
  }

  // Add page numbers & local privacy footer across all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawHairline(pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'Clearledger  |  Generated 100% locally on your device via jsPDF  |  No bank data sent to cloud',
      marginX,
      pageHeight - 8.5
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 8.5, {
      align: 'right',
    });
  }

  return doc;
}

export function downloadMonthlyPdfReport(
  report: MonthlyReportData,
  options: PdfReportOptions
): string {
  const doc = generateMonthlyPdfDocument(report, options);
  const safePeriod = report.periodKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `clearledger_analytics_ledger_${safePeriod}.pdf`;
  doc.save(fileName);
  return fileName;
}

/**
 * Triggers native browser print on the locally generated PDF blob via a hidden iframe,
 * avoiding window.open() popups in iframe sandboxes.
 */
export function printMonthlyPdfReport(
  report: MonthlyReportData,
  options: PdfReportOptions
): void {
  const doc = generateMonthlyPdfDocument(report, options);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = url;
  document.body.appendChild(iframe);

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // Fallback: save PDF directly if embedded print dialog is blocked
      doc.save(`clearledger_analytics_ledger_${report.periodKey}.pdf`);
    }
    window.setTimeout(() => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    }, 60_000);
  };
}

/**
 * Returns the most recent YYYY-MM present in the ledger (or 'summary' if empty).
 */
export function resolveCurrentMonthKey(transactions: Transaction[]): string {
  const latest = transactions
    .map((tx) => tx.date.slice(0, 7))
    .filter((mk) => /^\d{4}-\d{2}$/.test(mk))
    .sort()
    .pop();
  return latest ?? 'summary';
}

export interface CurrentMonthSummaryPdfParams {
  transactions: Transaction[];
  analytics: AnalyticsResult;
  categoryCaps?: Partial<Record<CategoryId, number>>;
  isaSettings: IsaPlannerSettings;
  debts?: DebtAccount[];
  currency: CurrencyCode;
  exchangeRates?: Partial<ExchangeRateTable>;
  paperFormat?: PdfPaperFormat;
}

/**
 * Generates a focused, printable jsPDF report for the latest imported month,
 * category cap variance, next-month spending trend projections, and 12-month recurring forecast.
 */
export function generateCurrentMonthSummaryPdfDocument(
  params: CurrentMonthSummaryPdfParams
): { doc: jsPDF; report: MonthlyReportData; fileName: string } {
  const periodKey = resolveCurrentMonthKey(params.transactions);
  const report = buildMonthlyReportData(
    params.transactions,
    params.analytics,
    params.categoryCaps,
    params.isaSettings,
    periodKey,
    params.currency,
    params.exchangeRates,
    params.debts ?? []
  );

  const doc = generateMonthlyPdfDocument(report, {
    currency: params.currency,
    exchangeRates: params.exchangeRates,
    paperFormat: params.paperFormat ?? 'a4',
    includeAnalyticalFindings: true,
    includeLedgerSummary: false,
    includeCategoryBreakdown: true,
    includeRecommendations: true,
    includeSubscriptions: true,
    includeSavingsVsDebt: (params.debts ?? []).some((d) => d.balance > 0),
    includeTopTransactions: true,
  });

  const safePeriod = report.periodKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `clearledger_summary_projections_${safePeriod}.pdf`;
  return { doc, report, fileName };
}

export function downloadCurrentMonthSummaryPdf(
  params: CurrentMonthSummaryPdfParams
): string {
  const { doc, fileName } = generateCurrentMonthSummaryPdfDocument(params);
  doc.save(fileName);
  return fileName;
}

