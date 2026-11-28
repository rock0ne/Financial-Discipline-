import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStatementDateContext,
  groupPdfPagesIntoRows,
  parseLeadingPdfDate,
  parsePdfMoneyCell,
  parsePdfStatementPages,
  resolveYearlessDate,
  type PdfExtractedPage,
  type PdfTextSpan,
} from '../src/utils/pdfStatementParser';

function makeRowSpans(
  y: number,
  cells: Array<{ x: number; text: string; width?: number }>
): PdfTextSpan[] {
  return cells.map((c) => ({
    x: c.x,
    y,
    text: c.text,
    width: c.width ?? Math.max(c.text.length * 5, 18),
    height: 10,
  }));
}

describe('pdfStatementParser (local UK/US/EU bank PDF statement engine)', () => {
  it('parses flexible full and yearless PDF date formats and money cells accurately', () => {
    assert.equal(parseLeadingPdfDate('02-OCT-26')?.isoDate, '2026-10-02');
    assert.equal(parseLeadingPdfDate('2 Oct 2026')?.isoDate, '2026-10-02');
    assert.equal(parseLeadingPdfDate('02/10/2026')?.isoDate, '2026-10-02');
    assert.equal(parseLeadingPdfDate('2026-10-02')?.isoDate, '2026-10-02');
    assert.deepEqual(parseLeadingPdfDate('02 Oct')?.yearless, { day: 2, month: 10 });
    assert.deepEqual(parseLeadingPdfDate('29-SEP')?.yearless, { day: 29, month: 9 });

    assert.deepEqual(parsePdfMoneyCell('£42.50'), {
      absValue: 42.5,
      explicitSign: null,
      currency: 'GBP',
      isOverdrawn: false,
    });
    assert.deepEqual(parsePdfMoneyCell('1,234.56 DR'), {
      absValue: 1234.56,
      explicitSign: -1,
      currency: undefined,
      isOverdrawn: true,
    });
    // Sort codes and plain integer references must never parse as money
    assert.equal(parsePdfMoneyCell('20-45-12'), null);
    assert.equal(parsePdfMoneyCell('12345678'), null);
  });

  it('extracts transactions from UK bank PDF with filename date, yearless rows, blank same-day dates, multi-line descriptions, and running balances', () => {
    const pages: PdfExtractedPage[] = [
      {
        pageNumber: 1,
        spans: [
          // Top account summary box (must not be parsed as transactions)
          ...makeRowSpans(780, [{ x: 40, text: 'Your Account Summary' }]),
          ...makeRowSpans(760, [
            { x: 40, text: 'Sort Code 20-45-12' },
            { x: 220, text: 'Account Number 12345678' },
          ]),
          ...makeRowSpans(740, [
            { x: 40, text: 'Balance on 03 Sep' },
            { x: 480, text: '£1,500.00' },
          ]),
          // Table Header
          ...makeRowSpans(700, [
            { x: 40, text: 'Date', width: 45 },
            { x: 100, text: 'Type', width: 30 },
            { x: 145, text: 'Description', width: 140 },
            { x: 350, text: 'Paid Out', width: 55 },
            { x: 425, text: 'Paid In', width: 55 },
            { x: 500, text: 'Balance', width: 60 },
          ]),
          // Brought forward balance seeds running-balance verification
          ...makeRowSpans(680, [
            { x: 145, text: 'BALANCE BROUGHT FORWARD' },
            { x: 505, text: '1,500.00', width: 55 },
          ]),
          // Tx 1: Yearless date + Paid Out
          ...makeRowSpans(655, [
            { x: 40, text: '29 Sep' },
            { x: 100, text: 'DEB' },
            { x: 145, text: 'TESCO STORES 2410' },
            { x: 365, text: '64.20', width: 40 },
            { x: 505, text: '1,435.80', width: 55 },
          ]),
          // Continuation line (no date, no amount) attaches cleanly to Tx 1
          ...makeRowSpans(642, [{ x: 145, text: 'CARD PAYMENT LONDON GB' }]),
          // Tx 2: Blank date on same day (inherits 2026-09-29!) + Paid Out
          ...makeRowSpans(620, [
            { x: 100, text: 'DD' },
            { x: 145, text: 'OCTOPUS ENERGY' },
            { x: 365, text: '112.50', width: 40 },
            { x: 505, text: '1,323.30', width: 55 },
          ]),
          // Tx 3: Salary Paid In (positive verified by both Paid In column AND balance delta!)
          ...makeRowSpans(595, [
            { x: 40, text: '01 Oct' },
            { x: 100, text: 'BGC' },
            { x: 145, text: 'ACME LTD PAYROLL' },
            { x: 430, text: '2,800.00', width: 50 },
            { x: 505, text: '4,123.30', width: 55 },
          ]),
          // Tx 4: Two-line entry where Date + Description appear on line 1, amount + balance on line 2
          ...makeRowSpans(570, [
            { x: 40, text: '02 Oct' },
            { x: 100, text: 'DEB' },
            { x: 145, text: 'PRET A MANGER' },
          ]),
          ...makeRowSpans(557, [
            { x: 145, text: 'CONTACTLESS VICTORIA' },
            { x: 365, text: '6.85', width: 40 },
            { x: 505, text: '4,116.45', width: 55 },
          ]),
          // Carried forward & footer boilerplate (must be skipped cleanly)
          ...makeRowSpans(520, [
            { x: 145, text: 'BALANCE CARRIED FORWARD' },
            { x: 505, text: '4,116.45', width: 55 },
          ]),
          ...makeRowSpans(490, [{ x: 40, text: 'Page 1 of 2 · Authorised by the Prudential Regulation Authority' }]),
        ],
      },
    ];

    const result = parsePdfStatementPages(
      pages,
      'Statement 02-OCT-26 AC 12345678 001.pdf',
      { defaultCurrency: 'GBP' }
    );

    assert.equal(result.warnings.length, 0);
    assert.equal(result.transactions.length, 4);

    assert.equal(result.transactions[0].date, '2026-09-29');
    assert.equal(result.transactions[0].amount, -64.2);
    assert.equal(result.transactions[0].merchant, 'Tesco');
    assert.ok(result.transactions[0].description.includes('CARD PAYMENT LONDON GB'));

    // Blank same-day row safely inherited 2026-09-29
    assert.equal(result.transactions[1].date, '2026-09-29');
    assert.equal(result.transactions[1].amount, -112.5);
    assert.equal(result.transactions[1].merchant, 'Octopus Energy');

    // Paid In credit row resolved as positive income
    assert.equal(result.transactions[2].date, '2026-10-01');
    assert.equal(result.transactions[2].amount, 2800);
    assert.equal(result.transactions[2].spendingClass, 'income');

    // Two-line transaction merged cleanly
    assert.equal(result.transactions[3].date, '2026-10-02');
    assert.equal(result.transactions[3].amount, -6.85);
    assert.equal(result.transactions[3].merchant, 'Pret A Manger');
    assert.ok(result.transactions[3].description.includes('CONTACTLESS VICTORIA'));
  });

  it('resolves December-to-January yearless statement periods across year rollover accurately', () => {
    const pages: PdfExtractedPage[] = [
      {
        pageNumber: 1,
        spans: [
          ...makeRowSpans(760, [{ x: 40, text: 'Statement Period: 16 Dec 2025 to 15 Jan 2026' }]),
          ...makeRowSpans(720, [
            { x: 40, text: 'Date' },
            { x: 120, text: 'Details' },
            { x: 380, text: 'Amount' },
          ]),
          ...makeRowSpans(690, [
            { x: 40, text: '28 Dec' },
            { x: 120, text: 'WAITROSE GROCERIES' },
            { x: 380, text: '-£54.10' },
          ]),
          ...makeRowSpans(665, [
            { x: 40, text: '04 Jan' },
            { x: 120, text: 'NETFLIX.COM' },
            { x: 380, text: '-£10.99' },
          ]),
        ],
      },
    ];

    const rows = groupPdfPagesIntoRows(pages);
    const ctx = extractStatementDateContext(rows, 'dec_jan_statement.pdf');
    assert.equal(ctx.periodStart, '2025-12-16');
    assert.equal(ctx.periodEnd, '2026-01-15');
    assert.equal(resolveYearlessDate(28, 12, ctx), '2025-12-28');
    assert.equal(resolveYearlessDate(4, 1, ctx), '2026-01-04');

    const parsed = parsePdfStatementPages(pages, 'dec_jan_statement.pdf');
    assert.equal(parsed.transactions.length, 2);
    assert.equal(parsed.transactions[0].date, '2025-12-28');
    assert.equal(parsed.transactions[1].date, '2026-01-04');
  });

  it('supports manual period override and warns cleanly on scanned/image-only PDFs', () => {
    const emptyPdf = parsePdfStatementPages([{ pageNumber: 1, spans: [] }], 'scanned_statement.pdf');
    assert.equal(emptyPdf.transactions.length, 0);
    assert.ok(emptyPdf.warnings[0].toLowerCase().includes('scanned'));

    const yearlessPages: PdfExtractedPage[] = [
      {
        pageNumber: 1,
        spans: [
          ...makeRowSpans(700, [
            { x: 40, text: '14 Mar' },
            { x: 120, text: 'TRAINLINE RAIL' },
            { x: 380, text: '-£38.40' },
          ]),
        ],
      },
    ];

    const withManualPeriod = parsePdfStatementPages(yearlessPages, 'march.pdf', {
      statementPeriodStart: '2024-03-01',
      statementPeriodEnd: '2024-03-31',
    });
    assert.equal(withManualPeriod.transactions.length, 1);
    assert.equal(withManualPeriod.transactions[0].date, '2024-03-14');
    assert.equal(withManualPeriod.transactions[0].amount, -38.4);
  });

  it('handles two-line wrapped UK bank headers, spaceless dates (02OCT), Paid-In-first ISA tables, and skips utility bills in mixed folders', () => {
    const wrappedPages: PdfExtractedPage[] = [
      {
        pageNumber: 1,
        spans: [
          // Two-line wrapped header: "Paid / in (£)" BEFORE "Paid / out (£)" (common on UK Cash ISA & bank PDFs)
          ...makeRowSpans(712, [
            { x: 40, text: 'Date', width: 45 },
            { x: 110, text: 'Payment type', width: 85 },
            { x: 340, text: 'Paid', width: 45 },
            { x: 415, text: 'Paid', width: 45 },
            { x: 495, text: 'Balance', width: 55 },
          ]),
          ...makeRowSpans(700, [
            { x: 110, text: 'and details', width: 85 },
            { x: 340, text: 'in (£)', width: 45 },
            { x: 415, text: 'out (£)', width: 45 },
            { x: 495, text: '(£)', width: 55 },
          ]),
          ...makeRowSpans(675, [
            { x: 40, text: '03JUL' },
            { x: 110, text: 'ISA DEPOSIT' },
            { x: 345, text: '500.00', width: 40 },
            { x: 420, text: '-', width: 10 },
            { x: 500, text: '2,500.00', width: 50 },
          ]),
          ...makeRowSpans(650, [
            { x: 40, text: 'Mon 04 Jul' },
            { x: 110, text: 'WITHDRAWAL TO CURRENT' },
            { x: 420, text: '100.00', width: 40 },
            { x: 500, text: '2,400.00', width: 50 },
          ]),
        ],
      },
    ];

    const isaParsed = parsePdfStatementPages(wrappedPages, 'Statement 03-JUL-26 CashISA.pdf', {
      defaultCurrency: 'GBP',
    });
    assert.equal(isaParsed.transactions.length, 2);
    assert.equal(isaParsed.transactions[0].date, '2026-07-03');
    assert.equal(isaParsed.transactions[0].amount, 500);
    assert.equal(isaParsed.transactions[1].date, '2026-07-04');
    assert.equal(isaParsed.transactions[1].amount, -100);

    // Non-statement utility bill PDF inside the same folder is skipped cleanly
    const billPages: PdfExtractedPage[] = [
      {
        pageNumber: 1,
        spans: [
          ...makeRowSpans(760, [{ x: 40, text: 'Octopus Energy - Your Electricity Supply Statement' }]),
          ...makeRowSpans(740, [{ x: 40, text: '02 Oct 2026  Meter reading 1420 kWh  £85.40' }]),
        ],
      },
    ];
    const billParsed = parsePdfStatementPages(billPages, 'fixtures/fictional-bill.pdf');
    assert.equal(billParsed.transactions.length, 0);
    assert.ok(billParsed.warnings[0].toLowerCase().includes('skipped'));
  });

  it('normalizes EU decimal commas without changing UK grouping or negative signs', () => {
    assert.equal(parsePdfMoneyCell('€12,34')?.absValue, 12.34);
    assert.equal(parsePdfMoneyCell('€1.234,56')?.absValue, 1234.56);
    assert.equal(parsePdfMoneyCell('-€1.234,56')?.explicitSign, -1);
    assert.equal(parsePdfMoneyCell('£1,234.56')?.absValue, 1234.56);
    assert.equal(parsePdfMoneyCell('£1,234.56 DR')?.explicitSign, -1);
    assert.equal(parsePdfMoneyCell('1,234,56'), null);
    const merged = groupPdfPagesIntoRows([{ pageNumber: 1, spans: [
      { x: 100, y: 500, width: 180, height: 10, text: 'FICTIONAL SHOP €1.234,56' },
    ] }]);
    assert.deepEqual(merged[0].cells.map((cell) => cell.text), ['FICTIONAL SHOP', '€1.234,56']);
  });

  it('rejects every staged row when a later dated transaction has an unreadable amount', () => {
    const pages: PdfExtractedPage[] = [{
      pageNumber: 1,
      spans: [
        ...makeRowSpans(700, [
          { x: 40, text: 'Date' },
          { x: 120, text: 'Details' },
          { x: 380, text: 'Amount' },
        ]),
        ...makeRowSpans(680, [
          { x: 40, text: '01 Nov 2026' },
          { x: 120, text: 'FICTIONAL SHOP' },
          { x: 380, text: '-£10.00' },
        ]),
        ...makeRowSpans(660, [
          { x: 40, text: '02 Nov 2026' },
          { x: 120, text: 'FICTIONAL CAFE' },
          { x: 380, text: '20,0X' },
        ]),
      ],
    }];
    const parsed = parsePdfStatementPages(pages, 'fictional.pdf');
    assert.equal(parsed.transactions.length, 0);
    assert.match(parsed.warnings[0], /No rows from this PDF were staged/);
    assert.doesNotMatch(parsed.warnings.join(' '), /FICTIONAL CAFE/);
  });

  it('rejects an unsigned amount when no trustworthy direction evidence exists', () => {
    const pages: PdfExtractedPage[] = [{
      pageNumber: 1,
      spans: [
        ...makeRowSpans(700, [
          { x: 40, text: 'Date' },
          { x: 120, text: 'Details' },
          { x: 380, text: 'Amount' },
        ]),
        ...makeRowSpans(680, [
          { x: 40, text: '01 Nov 2026' },
          { x: 120, text: 'FICTIONAL SHOP' },
          { x: 380, text: '-£10.00' },
        ]),
        ...makeRowSpans(660, [
          { x: 40, text: '02 Nov 2026' },
          { x: 120, text: 'ACME TRANSFER' },
          { x: 380, text: '100.00' },
        ]),
      ],
    }];
    const parsed = parsePdfStatementPages(pages, 'fictional.pdf');
    assert.equal(parsed.transactions.length, 0);
    assert.match(parsed.warnings[0], /no verifiable direction/);
  });

  it('rejects a yearless transaction outside an explicit statement period', () => {
    const pages: PdfExtractedPage[] = [{
      pageNumber: 1,
      spans: [
        ...makeRowSpans(700, [
          { x: 40, text: 'Date' },
          { x: 120, text: 'Details' },
          { x: 380, text: 'Amount' },
        ]),
        ...makeRowSpans(680, [
          { x: 40, text: '05 Jun' },
          { x: 120, text: 'FICTIONAL SHOP' },
          { x: 380, text: '-£10.00' },
        ]),
      ],
    }];
    const options = {
      statementPeriodStart: '2026-10-01',
      statementPeriodEnd: '2026-10-31',
    };
    const parsed = parsePdfStatementPages(pages, 'fictional.pdf', options);
    assert.equal(resolveYearlessDate(5, 6, extractStatementDateContext(groupPdfPagesIntoRows(pages), 'fictional.pdf', options)), null);
    assert.equal(parsed.transactions.length, 0);
    assert.match(parsed.warnings[0], /outside the statement period/);
  });

  it('rejects an explicit amount sign that contradicts the running balance', () => {
    const pages: PdfExtractedPage[] = [{
      pageNumber: 1,
      spans: [
        ...makeRowSpans(700, [
          { x: 40, text: 'Date' },
          { x: 120, text: 'Description' },
          { x: 380, text: 'Paid Out' },
          { x: 500, text: 'Balance' },
        ]),
        ...makeRowSpans(680, [
          { x: 120, text: 'BALANCE BROUGHT FORWARD' },
          { x: 500, text: '100.00' },
        ]),
        ...makeRowSpans(660, [
          { x: 40, text: '01 Nov 2026' },
          { x: 120, text: 'FICTIONAL SHOP' },
          { x: 380, text: '+£10.00' },
          { x: 500, text: '90.00' },
        ]),
      ],
    }];
    const parsed = parsePdfStatementPages(pages, 'fictional.pdf');
    assert.equal(parsed.transactions.length, 0);
    assert.match(parsed.warnings[0], /no verifiable direction/i);
  });

  it('rejects ambiguous numeric dates instead of inheriting a previous row date', () => {
    assert.equal(parseLeadingPdfDate('13/04/2026')?.isoDate, '2026-04-13');
    assert.equal(parseLeadingPdfDate('04/13/2026')?.isoDate, '2026-04-13');
    const pages: PdfExtractedPage[] = [{
      pageNumber: 1,
      spans: [
        ...makeRowSpans(700, [
          { x: 40, text: 'Date' },
          { x: 120, text: 'Details' },
          { x: 380, text: 'Amount' },
        ]),
        ...makeRowSpans(680, [
          { x: 40, text: '13/04/2026' },
          { x: 120, text: 'FICTIONAL SHOP' },
          { x: 380, text: '-£10.00' },
        ]),
        ...makeRowSpans(660, [
          { x: 40, text: '03/04/2026' },
          { x: 120, text: 'FICTIONAL CAFE' },
          { x: 380, text: '-£20.00' },
        ]),
      ],
    }];
    const parsed = parsePdfStatementPages(pages, 'fictional.pdf');
    assert.equal(parsed.transactions.length, 0);
    assert.match(parsed.warnings[0], /ambiguous numeric PDF date/);
  });

  it('does not treat a pre-table dated summary as an unfinished transaction', () => {
    const pages: PdfExtractedPage[] = [{
      pageNumber: 1,
      spans: [
        ...makeRowSpans(760, [
          { x: 40, text: '05 Nov 2026' },
          { x: 120, text: 'ACCOUNT OVERVIEW' },
        ]),
        ...makeRowSpans(740, [
          { x: 120, text: 'BALANCE BROUGHT FORWARD' },
          { x: 500, text: '100.00' },
        ]),
        ...makeRowSpans(700, [
          { x: 40, text: 'Date' },
          { x: 120, text: 'Description' },
          { x: 380, text: 'Paid Out' },
          { x: 500, text: 'Balance' },
        ]),
        ...makeRowSpans(680, [
          { x: 40, text: '01 Nov 2026' },
          { x: 120, text: 'FICTIONAL SHOP' },
          { x: 380, text: '10.00' },
          { x: 500, text: '90.00' },
        ]),
      ],
    }];
    const parsed = parsePdfStatementPages(pages, 'fictional.pdf');
    assert.equal(parsed.transactions.length, 1);
    assert.equal(parsed.transactions[0].amount, -10);
    assert.equal(parsed.warnings.length, 0);
  });

  it('carries verified movements across blank balance cells before reconciling the next balance', () => {
    const pages: PdfExtractedPage[] = [{
      pageNumber: 1,
      spans: [
        ...makeRowSpans(700, [
          { x: 40, text: 'Date' },
          { x: 120, text: 'Description' },
          { x: 350, text: 'Paid Out' },
          { x: 425, text: 'Paid In' },
          { x: 500, text: 'Balance' },
        ]),
        ...makeRowSpans(680, [
          { x: 120, text: 'BALANCE BROUGHT FORWARD' },
          { x: 500, text: '100.00' },
        ]),
        ...makeRowSpans(660, [
          { x: 40, text: '01 Nov 2026' },
          { x: 120, text: 'FICTIONAL SHOP' },
          { x: 350, text: '10.00' },
          { x: 500, text: '90.00' },
        ]),
        ...makeRowSpans(640, [
          { x: 120, text: 'FICTIONAL CAFE' },
          { x: 350, text: '20.00' },
        ]),
        ...makeRowSpans(620, [
          { x: 120, text: 'FICTIONAL REFUND' },
          { x: 425, text: '5.00' },
          { x: 500, text: '75.00' },
        ]),
      ],
    }];
    const parsed = parsePdfStatementPages(pages, 'fictional.pdf');
    assert.equal(parsed.transactions.length, 3);
    assert.deepEqual(parsed.transactions.map((tx) => tx.amount), [-10, -20, 5]);
    assert.equal(parsed.warnings.length, 0);

    const contradicted: PdfExtractedPage[] = [{
      pageNumber: 1,
      spans: pages[0].spans.map((span) =>
        span.y === 620 && span.x === 500 ? { ...span, text: '76.00' } : span
      ),
    }];
    const rejected = parsePdfStatementPages(contradicted, 'fictional.pdf');
    assert.equal(rejected.transactions.length, 0);
    assert.match(rejected.warnings[0], /running balance/);
  });

  it('keeps verified transactions before a standalone overdraft-cost disclosure page', () => {
    const transactionPage: PdfExtractedPage = {
      pageNumber: 1,
      spans: [
        ...makeRowSpans(700, [
          { x: 40, text: 'Date' },
          { x: 120, text: 'Description' },
          { x: 350, text: 'Paid Out' },
          { x: 425, text: 'Paid In' },
          { x: 500, text: 'Balance' },
        ]),
        ...makeRowSpans(680, [
          { x: 120, text: 'BALANCE BROUGHT FORWARD' },
          { x: 500, text: '100.00' },
        ]),
        ...makeRowSpans(660, [
          { x: 40, text: '01 Nov 2026' },
          { x: 120, text: 'FICTIONAL SHOP' },
          { x: 350, text: '10.00' },
          { x: 500, text: '90.00' },
        ]),
      ],
    };
    const disclosurePage: PdfExtractedPage = {
      pageNumber: 2,
      spans: [
        ...makeRowSpans(700, [{ x: 40, text: 'Unarranged overdraft interest' }]),
        ...makeRowSpans(680, [{ x: 40, text: 'Nominal monthly rate' }]),
        ...makeRowSpans(660, [{ x: 40, text: 'Unpaid transaction fees' }]),
        ...makeRowSpans(640, [{ x: 40, text: 'Maximum monthly charge' }]),
        ...makeRowSpans(620, [
          { x: 40, text: 'Account costs' },
          { x: 290, text: 'A' },
          { x: 360, text: 'B' },
          { x: 430, text: 'C' },
          { x: 500, text: 'D' },
        ]),
        ...makeRowSpans(600, [
          { x: 120, text: 'Illustrative costs only' },
          { x: 290, text: '1.00' },
          { x: 360, text: '2.00' },
          { x: 430, text: '3.00' },
          { x: 500, text: '4.00' },
        ]),
      ],
    };

    const parsed = parsePdfStatementPages([transactionPage, disclosurePage], 'fictional.pdf');
    assert.equal(parsed.transactions.length, 1);
    assert.equal(parsed.transactions[0].amount, -10);
    assert.equal(parsed.warnings.length, 0);

    const insufficientMarkers: PdfExtractedPage = {
      ...disclosurePage,
      spans: disclosurePage.spans.filter(
        (span) => span.text !== 'Maximum monthly charge' && span.text !== 'Nominal monthly rate'
      ),
    };
    const rejected = parsePdfStatementPages([transactionPage, insufficientMarkers], 'fictional.pdf');
    assert.equal(rejected.transactions.length, 0);
    assert.match(rejected.warnings[0], /No rows from this PDF were staged/);

    const mixedPage: PdfExtractedPage = {
      ...disclosurePage,
      spans: [
        ...disclosurePage.spans,
        ...makeRowSpans(580, [
          { x: 40, text: '02 Nov 2026' },
          { x: 120, text: 'FICTIONAL MALFORMED ENTRY' },
          { x: 350, text: '5.00' },
          { x: 425, text: '7.00' },
          { x: 500, text: '92.00' },
        ]),
      ],
    };
    const mixedRejected = parsePdfStatementPages([transactionPage, mixedPage], 'fictional.pdf');
    assert.equal(mixedRejected.transactions.length, 0);
    assert.match(mixedRejected.warnings[0], /No rows from this PDF were staged/);
  });

  it('still rejects a dated row with multiple non-zero transaction amounts', () => {
    const pages: PdfExtractedPage[] = [{
      pageNumber: 1,
      spans: [
        ...makeRowSpans(700, [
          { x: 40, text: 'Date' },
          { x: 120, text: 'Description' },
          { x: 350, text: 'Paid Out' },
          { x: 425, text: 'Paid In' },
          { x: 500, text: 'Balance' },
        ]),
        ...makeRowSpans(680, [
          { x: 120, text: 'BALANCE BROUGHT FORWARD' },
          { x: 500, text: '100.00' },
        ]),
        ...makeRowSpans(660, [
          { x: 40, text: '01 Nov 2026' },
          { x: 120, text: 'FICTIONAL SHOP' },
          { x: 350, text: '10.00' },
          { x: 425, text: '3.00' },
          { x: 500, text: '93.00' },
        ]),
      ],
    }];
    const parsed = parsePdfStatementPages(pages, 'fictional.pdf');
    assert.equal(parsed.transactions.length, 0);
    assert.match(parsed.warnings[0], /No rows from this PDF were staged/);
  });
});
