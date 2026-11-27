import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupPdfPageText,
  parsePdfStatementRows,
  type PdfTextRow,
} from '../src/utils/pdfStatementParser';
import { buildDedupKey } from '../src/utils/statementParser';
import { makeSyntheticStatementPdf } from './syntheticPdfFixture';

function row(page: number, y: number, values: Array<[number, string]>): PdfTextRow {
  return {
    page,
    y,
    cells: values.map(([x, text]) => ({ x, y, text, width: Math.max(15, text.length * 6) })),
  };
}

const header = (page: number, y: number) =>
  row(page, y, [
    [40, 'Date'],
    [120, 'Description'],
    [350, 'Debit'],
    [430, 'Credit'],
    [510, 'Balance'],
  ]);

describe('local PDF statement table parser', () => {
  it('reads a real synthetic PDF text layer using PDF.js before applying the table parser', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: makeSyntheticStatementPdf(), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const cells = content.items
        .filter((item): item is typeof item & { str: string; transform: number[]; width: number } => 'str' in item && 'transform' in item && 'width' in item)
        .filter((item) => item.str.trim())
        .map((item) => ({
          text: item.str.trim(),
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
        }));
      const rows = groupPdfPageText(1, cells);
      const result = parsePdfStatementRows(rows, 'synthetic-statement.pdf');
      assert.deepEqual(result.transactions.map((tx) => tx.amount), [-14.5, 2500]);
      assert.equal(result.transactions[0].description, 'Trainline ticket');
      assert.equal(result.transactions[1].description, 'Salary payroll');
    } finally {
      await task.destroy();
    }
  });

  it('extracts distinct signed transactions, ignores running balances and joins a wrapped description', () => {
    const result = parsePdfStatementRows(
      [
        row(1, 740, [[40, 'Account statement GBP']]),
        header(1, 700),
        row(1, 680, [[40, '03/11/2026'], [120, 'Trainline ticket'], [350, '£14.50'], [510, '£985.50']]),
        row(1, 664, [[120, 'London to Reading']]),
        row(1, 640, [[40, '04/11/2026'], [120, 'Salary payroll'], [430, '£2,500.00'], [510, '£3,485.50']]),
        row(1, 620, [[40, '04/11/2026'], [120, 'Closing Balance'], [510, '£3,485.50']]),
      ],
      'current-account.pdf'
    );
    assert.equal(result.transactions.length, 2);
    assert.deepEqual(result.transactions.map((tx) => [tx.date, tx.amount, tx.currency]), [
      ['2026-11-03', -14.5, 'GBP'],
      ['2026-11-04', 2500, 'GBP'],
    ]);
    assert.equal(result.transactions[0].description, 'Trainline ticket London to Reading');
    assert.match(result.warnings.join(' '), /Review every transaction/);
  });

  it('repeated page headers do not become transactions', () => {
    const result = parsePdfStatementRows(
      [
        row(1, 740, [[40, 'GBP']]),
        header(1, 700),
        row(1, 680, [[40, '03/11/2026'], [120, 'Tesco'], [350, '£23.40']]),
        header(2, 700),
        row(2, 680, [[40, '04/11/2026'], [120, 'Waitrose'], [350, '£12.10']]),
      ],
      'statement.pdf'
    );
    assert.equal(result.transactions.length, 2);
  });

  it('rejects the entire PDF if a transaction-like row has an invalid date or ambiguous amount', () => {
    const invalidDate = parsePdfStatementRows(
      [row(1, 740, [[40, 'GBP']]), header(1, 700), row(1, 680, [[40, '31/02/2026'], [120, 'Tesco'], [350, '£23.40']])],
      'bad.pdf'
    );
    assert.equal(invalidDate.transactions.length, 0);
    assert.match(invalidDate.warnings.join(' '), /could not be interpreted safely/);

    const bothDirections = parsePdfStatementRows(
      [row(1, 740, [[40, 'GBP']]), header(1, 700), row(1, 680, [[40, '03/11/2026'], [120, 'Unknown'], [350, '£23.40'], [430, '£23.40']])],
      'bad.pdf'
    );
    assert.equal(bothDirections.transactions.length, 0);
  });

  it('rejects a balance-only table and unsupported/scanned content', () => {
    const result = parsePdfStatementRows(
      [row(1, 700, [[40, 'Date'], [120, 'Description'], [510, 'Balance']])],
      'scan.pdf'
    );
    assert.equal(result.transactions.length, 0);
    assert.match(result.warnings.join(' '), /scanned|unsupported layout/i);
  });

  it('requires an explicit debit/credit sign for a single Amount column', () => {
    const amountHeader = row(1, 700, [[40, 'Date'], [120, 'Description'], [350, 'Amount'], [510, 'Balance']]);
    const ambiguous = parsePdfStatementRows(
      [row(1, 740, [[40, 'GBP']]), amountHeader, row(1, 680, [[40, '03/11/2026'], [120, 'Tesco'], [350, '£23.40'], [510, '£976.60']])],
      'ambiguous.pdf'
    );
    assert.equal(ambiguous.transactions.length, 0);
    const signed = parsePdfStatementRows(
      [row(1, 740, [[40, 'GBP']]), amountHeader, row(1, 680, [[40, '03/11/2026'], [120, 'Tesco'], [350, '-£23.40'], [510, '£976.60']])],
      'signed.pdf'
    );
    assert.equal(signed.transactions[0].amount, -23.4);
  });

  it('refuses conflicting direction and mixed currencies in one transaction row', () => {
    const amountWithType = row(1, 700, [[40, 'Date'], [120, 'Description'], [350, 'Amount'], [430, 'Type']]);
    const conflict = parsePdfStatementRows(
      [row(1, 740, [[40, 'GBP']]), amountWithType, row(1, 680, [[40, '03/11/2026'], [120, 'Tesco'], [350, '-£23.40'], [430, 'Credit']])],
      'conflict.pdf'
    );
    assert.equal(conflict.transactions.length, 0);
    const mixed = parsePdfStatementRows(
      [header(1, 700), row(1, 680, [[40, '03/11/2026'], [120, 'Tesco'], [350, '£23.40'], [430, '$23.40']])],
      'mixed.pdf'
    );
    assert.equal(mixed.transactions.length, 0);
  });

  it('keeps identical transactions in different accounts distinct for deduplication', () => {
    const rows = [row(1, 740, [[40, 'GBP']]), header(1, 700), row(1, 680, [[40, '03/11/2026'], [120, 'Tesco'], [350, '£23.40']])];
    const first = parsePdfStatementRows(rows, 'account-a.pdf').transactions[0];
    const second = parsePdfStatementRows(rows, 'account-b.pdf').transactions[0];
    const reimport = { ...first, id: 'reimport' };
    assert.notEqual(buildDedupKey(first), buildDedupKey(second));
    assert.equal(buildDedupKey(first), buildDedupKey(reimport));
  });
});
