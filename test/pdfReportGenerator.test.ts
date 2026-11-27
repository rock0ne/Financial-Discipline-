import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMonthlyReportData,
  generateCurrentMonthSummaryPdfDocument,
  generateMonthlyPdfDocument,
  resolveCurrentMonthKey,
} from '../src/utils/pdfReportGenerator';
import {
  analyzeLedgerSmartTags,
  computeTopMerchantsByCategoryOverTime,
  computeTwentyFourMonthSpendingTrend,
  runLocalFinancialAnalytics,
} from '../src/utils/analyticsEngine';
import { exportTransactionsToCsv } from '../src/utils/statementParser';
import type { CategoryId, IsaPlannerSettings, Transaction } from '../src/types/finance';

const DEFAULT_ISA: IsaPlannerSettings = {
  cashIsaRate: 4.85,
  currentAccountRate: 0.5,
  stocksIsaRate: 7.0,
  lisaRate: 4.5,
  horizonYears: 5,
  taxBand: 'basic_20',
  cashIsaSplitPct: 50,
  lisaSplitPct: 20,
  stocksIsaSplitPct: 30,
  customMonthlyOverride: null,
};

let txSeq = 0;

function makeTx(
  date: string,
  merchant: string,
  category: CategoryId,
  amount: number
): Transaction {
  txSeq += 1;
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
    id: `pdf-tx-${txSeq}`,
    date,
    merchant,
    description: merchant,
    amount,
    currency: 'GBP',
    category,
    spendingClass,
    accountName: 'Current Account',
  };
}

describe('pdfReportGenerator (jsPDF analytical findings & ledger summary)', () => {
  it('builds analytical findings, smart-tag totals, and ledger summary data accurately', () => {
    const txs: Transaction[] = [
      makeTx('2026-09-01', 'Employer Payroll', 'salary_income', 3800),
      makeTx('2026-09-05', 'Waitrose', 'groceries', -220),
      makeTx('2026-09-12', 'HMRC Self Assessment', 'other_discretionary', -150),
      makeTx('2026-09-18', 'Trainline Business Rail', 'transport', -60.4),
      makeTx('2026-10-01', 'Employer Payroll', 'salary_income', 3800),
      makeTx('2026-10-06', 'Waitrose', 'groceries', -230),
      makeTx('2026-10-15', 'Adobe Creative Cloud', 'subscriptions', -54.99),
      makeTx('2026-10-28', 'Trainline Business Rail', 'transport', -60.4),
    ];

    const caps: Partial<Record<CategoryId, number>> = {
      transport: 60,
      groceries: 250,
    };

    const analytics = runLocalFinancialAnalytics(
      txs,
      {},
      {},
      'all',
      {},
      caps,
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 10, 5) }
    );

    const report = buildMonthlyReportData(
      txs,
      analytics,
      caps,
      DEFAULT_ISA,
      'summary',
      'GBP'
    );

    assert.equal(report.ledgerSummary.totalRows, 8);
    assert.equal(report.ledgerSummary.inflowCount, 2);
    assert.equal(report.ledgerSummary.outflowCount, 6);
    assert.equal(report.ledgerSummary.dateRangeStart, '2026-09-01');
    assert.equal(report.ledgerSummary.dateRangeEnd, '2026-10-28');
    assert.ok(report.ledgerSummary.topMerchants.length > 0);
    assert.ok(report.smartTags.eitherTagCount >= 1);

    const transportRow = report.categories.find((c) => c.categoryId === 'transport');
    assert.ok(transportRow);
    assert.equal(transportRow.amount, 60.4);
    assert.equal(transportRow.variance, 0.4);
  });

  it('generates a clean, printable multi-section PDF binary via jsPDF in both A4 and Letter formats', () => {
    const txs: Transaction[] = [];
    for (let i = 1; i <= 25; i++) {
      const day = String(Math.min(28, i)).padStart(2, '0');
      txs.push(makeTx(`2026-10-${day}`, `Merchant ${i}`, 'dining_takeaway', -(15 + i * 1.25)));
    }
    txs.push(makeTx('2026-10-01', 'Employer Payroll', 'salary_income', 4200));

    const caps: Partial<Record<CategoryId, number>> = { dining_takeaway: 500 };
    const analytics = runLocalFinancialAnalytics(
      txs,
      {},
      {},
      'all',
      {},
      caps,
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 10, 5) }
    );
    const report = buildMonthlyReportData(
      txs,
      analytics,
      caps,
      DEFAULT_ISA,
      '2026-10',
      'GBP'
    );

    const docA4 = generateMonthlyPdfDocument(report, {
      currency: 'GBP',
      paperFormat: 'a4',
      includeAnalyticalFindings: true,
      includeLedgerSummary: true,
      includeCategoryBreakdown: true,
      includeRecommendations: true,
      includeSubscriptions: true,
      includeSavingsVsDebt: true,
      includeTopTransactions: true,
    });
    const pdfOutputA4 = docA4.output('datauristring');
    assert.ok(pdfOutputA4.startsWith('data:application/pdf'));
    assert.ok(docA4.getNumberOfPages() >= 2);

    const docLetter = generateMonthlyPdfDocument(report, {
      currency: 'USD',
      paperFormat: 'letter',
      includeAnalyticalFindings: true,
      includeLedgerSummary: true,
      includeCategoryBreakdown: true,
      includeRecommendations: false,
      includeSubscriptions: false,
      includeSavingsVsDebt: false,
      includeTopTransactions: false,
    });
    assert.ok(docLetter.output('datauristring').startsWith('data:application/pdf'));
    assert.ok(Math.abs(docLetter.internal.pageSize.getWidth() - 215.9) < 1);
  });

  it('exports spreadsheet-ready CSV with UTF-8 BOM, Smart Tags, converted amounts, and formula escaping', () => {
    const txs: Transaction[] = [
      makeTx('2026-10-05', '=CMD() Evil Corp', 'other_discretionary', -42.5),
      makeTx('2026-10-12', 'HMRC Self Assessment', 'other_discretionary', -150),
    ];
    const smart = analyzeLedgerSmartTags(txs, 'GBP');
    const csv = exportTransactionsToCsv(txs, 'GBP', {
      smartTagsByTxId: smart.byTransactionId,
    });

    assert.ok(csv.startsWith('\uFEFFDate,Merchant,Description,Amount,Currency,DisplayAmount (GBP)'));
    assert.ok(csv.includes('"\'=CMD() Evil Corp"'));
    assert.ok(csv.includes('Tax Deductible'));
    assert.ok(csv.includes('-42.50,GBP,-42.50'));
  });

  it('computes top spending merchants by category over time for bar chart visualization', () => {
    const txs: Transaction[] = [
      makeTx('2026-08-03', 'Waitrose', 'groceries', -120),
      makeTx('2026-08-10', 'Tesco', 'groceries', -80),
      makeTx('2026-08-14', 'Deliveroo', 'dining_takeaway', -55),
      makeTx('2026-09-04', 'Waitrose', 'groceries', -150),
      makeTx('2026-09-11', 'Tesco', 'groceries', -60),
      makeTx('2026-09-18', 'Deliveroo', 'dining_takeaway', -90),
    ];

    const groceriesTrend = computeTopMerchantsByCategoryOverTime(
      txs,
      'groceries',
      'GBP',
      undefined,
      5,
      12
    );

    assert.equal(groceriesTrend.monthCount, 2);
    assert.equal(groceriesTrend.totalSpend, 410);
    assert.equal(groceriesTrend.merchants[0].merchant, 'Waitrose');
    assert.equal(groceriesTrend.merchants[0].totalSpend, 270);
    assert.equal(groceriesTrend.merchants[1].merchant, 'Tesco');
    assert.equal(groceriesTrend.months[0].m_0, 120);
    assert.equal(groceriesTrend.months[1].m_0, 150);
    assert.equal(groceriesTrend.activeCategories.length, 2);
  });

  it('exports current month spending summary and projections as a printable jsPDF report', () => {
    const txs: Transaction[] = [
      makeTx('2026-08-01', 'Employer Payroll', 'salary_income', 4200),
      makeTx('2026-08-05', 'Netflix', 'subscriptions', -17.99),
      makeTx('2026-08-12', 'Waitrose', 'groceries', -210.5),
      makeTx('2026-09-01', 'Employer Payroll', 'salary_income', 4200),
      makeTx('2026-09-05', 'Netflix', 'subscriptions', -17.99),
      makeTx('2026-09-12', 'Waitrose', 'groceries', -235.25),
      makeTx('2026-10-01', 'Employer Payroll', 'salary_income', 4200),
      makeTx('2026-10-05', 'Netflix', 'subscriptions', -17.99),
      makeTx('2026-10-14', 'Waitrose', 'groceries', -260.4),
    ];

    assert.equal(resolveCurrentMonthKey(txs), '2026-10');

    const caps: Partial<Record<CategoryId, number>> = { groceries: 250 };
    const analytics = runLocalFinancialAnalytics(
      txs,
      {},
      {},
      'all',
      {},
      caps,
      'GBP',
      undefined,
      { referenceDate: new Date(2026, 10, 5) }
    );
    const { doc, report, fileName } = generateCurrentMonthSummaryPdfDocument({
      transactions: txs,
      analytics,
      categoryCaps: caps,
      isaSettings: DEFAULT_ISA,
      currency: 'GBP',
      paperFormat: 'a4',
    });

    assert.equal(report.periodKey, '2026-10');
    assert.equal(fileName, 'clearledger_summary_projections_2026-10.pdf');
    assert.ok(report.subscriptionAnnualProjection.itemCount >= 1);
    assert.ok(doc.output('datauristring').startsWith('data:application/pdf'));
    assert.ok(doc.getNumberOfPages() >= 1);
  });

  it('computes a continuous 24-month yearly spending trend with rolling average and YoY pace', () => {
    const txs: Transaction[] = [];
    // Populate 24 consecutive months: Year 1 (2024-12..2025-11) = £1,000/mo, Year 2 (2025-12..2026-11) = £900/mo (-10% YoY)
    for (let i = 0; i < 24; i++) {
      const totalIdx = 2024 * 12 + 11 + i; // starts at 2024-12
      const y = Math.floor(totalIdx / 12);
      const m = (totalIdx % 12) + 1;
      const dateStr = `${y}-${String(m).padStart(2, '0')}-10`;
      const isSecondYear = i >= 12;
      txs.push(makeTx(dateStr, 'Landlord', 'housing', isSecondYear ? -600 : -650));
      txs.push(makeTx(dateStr, 'Dining', 'dining_takeaway', isSecondYear ? -300 : -350));
    }

    const trend = computeTwentyFourMonthSpendingTrend(txs, 'GBP', undefined, 24);
    assert.equal(trend.points.length, 24);
    assert.equal(trend.observedMonthsCount, 24);
    assert.equal(trend.points[0].monthKey, '2024-12');
    assert.equal(trend.points[23].monthKey, '2026-11');
    assert.equal(trend.priorYearAvg, 1000);
    assert.equal(trend.recentYearAvg, 900);
    assert.equal(trend.yoyDeltaPct, -10);
    assert.equal(trend.totalExpenditure, 22800);
    assert.equal(trend.monthlyAverage, 950);
    assert.equal(trend.points[23].rolling3mAvg, 900);
  });
});
