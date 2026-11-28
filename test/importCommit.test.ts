import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSample14MonthData } from '../src/utils/sampleData';
import { createEmptyVault } from '../src/utils/emptyVault';
import {
  applyConfirmedPdfAccountLabels,
  commitStatementImport,
  getImportReviewBlockers,
  hasImportReceipt,
  isValidPdfAccountLabel,
} from '../src/utils/importCommit';
import type { StatementImportMeta, Transaction, VaultPayload } from '../src/types/finance';

function transaction(accountName: string, id: string): Transaction {
  return {
    id,
    date: '2026-11-03',
    description: 'Synthetic Grocery',
    merchant: 'Synthetic Grocery',
    amount: -23.4,
    currency: 'GBP',
    category: 'groceries',
    spendingClass: 'essential',
    accountName,
    sourceFile: `${accountName}.pdf`,
    importBatchId: `batch-${accountName}`,
  };
}

function meta(accountName: string): StatementImportMeta {
  return {
    id: `batch-${accountName}`,
    fileName: `${accountName}.pdf`,
    importedAt: '2026-11-27T10:00:00.000Z',
    rowCount: 1,
    duplicatesSkipped: 0,
    dateRangeStart: '2026-11-03',
    dateRangeEnd: '2026-11-03',
  };
}

describe('confirmed statement import', () => {
  it('explains every PDF review gate without treating a parsed row count as consent', () => {
    const pending = {
      pdfCount: 8,
      missingPdfLabels: 8,
      reviewedPdf: false,
      failedFiles: 0,
      acceptPartial: false,
    };
    assert.deepEqual(getImportReviewBlockers(pending), ['pdf_labels', 'pdf_review']);
    assert.deepEqual(getImportReviewBlockers({ ...pending, missingPdfLabels: 0 }), ['pdf_review']);
    assert.deepEqual(getImportReviewBlockers({ ...pending, missingPdfLabels: 0, reviewedPdf: true }), []);
    assert.deepEqual(getImportReviewBlockers({ ...pending, missingPdfLabels: 0, reviewedPdf: true, failedFiles: 1 }), ['partial_import']);
    assert.deepEqual(getImportReviewBlockers({ ...pending, missingPdfLabels: 0, reviewedPdf: true, failedFiles: 1, acceptPartial: true }), []);
    assert.deepEqual(getImportReviewBlockers({ ...pending, pdfCount: 0, missingPdfLabels: 0 }), []);
  });

  it('does not acknowledge success before the local vault write resolves', async () => {
    const payload = { ...generateSample14MonthData(), transactions: [], imports: [] };
    let finishSave: (() => void) | undefined;
    const saving = new Promise<void>((resolve) => { finishSave = resolve; });
    let settled = false;
    const resultPromise = commitStatementImport(
      payload,
      [transaction('account-a', 'a')],
      [meta('account-a')],
      true,
      async () => { await saving; }
    ).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    assert.equal(settled, false);
    finishSave?.();
    const result = await resultPromise;
    assert.deepEqual(result, { added: 1, skipped: 0 });
  });

  it('rejects a failed vault write and leaves caller without a success result', async () => {
    const payload = { ...generateSample14MonthData(), transactions: [], imports: [] };
    await assert.rejects(
      commitStatementImport(
        payload,
        [transaction('account-a', 'a')],
        [meta('account-a')],
        true,
        async () => { throw new Error('synthetic storage refusal'); }
      ),
      /synthetic storage refusal/
    );
    assert.equal(payload.transactions.length, 0);
    assert.equal(hasImportReceipt(payload, [meta('account-a')]), false);
  });

  it('deduplicates per account rather than discarding a matching transaction in another account', async () => {
    const payload = {
      ...createEmptyVault(),
      transactions: [transaction('account-a', 'existing')],
      imports: [meta('account-a')],
    };
    let saved: VaultPayload = payload;
    const result = await commitStatementImport(
      payload,
      [transaction('account-a', 'repeat'), transaction('account-b', 'new')],
      [meta('account-a'), meta('account-b')],
      false,
      async (next) => { saved = next; }
    );
    assert.deepEqual(result, { added: 1, skipped: 1 });
    assert.equal(saved.transactions.length, 2);
    assert.equal(saved.transactions.find((tx) => tx.id === 'new')?.accountName, 'account-b');
  });

  it('requires a stable account label and keeps two distinct accounts with the same PDF basename', async () => {
    const first = {
      ...transaction('statement', 'one'),
      sourceFile: 'bank-a/statement.pdf',
      importBatchId: 'batch-a',
    };
    const second = {
      ...transaction('statement', 'two'),
      sourceFile: 'bank-b/statement.pdf',
      importBatchId: 'batch-b',
    };
    assert.equal(isValidPdfAccountLabel(''), false);
    assert.equal(isValidPdfAccountLabel('Account 12345678'), false);
    assert.equal(isValidPdfAccountLabel('Account 60-04-20'), false);
    assert.throws(() => applyConfirmedPdfAccountLabels([first], {}), /confirmed stable account label/);
    const labeled = applyConfirmedPdfAccountLabels(
      [first, second],
      { 'batch-a': 'Current Account A', 'batch-b': 'Current Account B' }
    );
    assert.notEqual(labeled[0].accountName, labeled[1].accountName);
    const payload = { ...generateSample14MonthData(), transactions: [], imports: [] };
    const result = await commitStatementImport(
      payload,
      labeled,
      [
        { ...meta('statement'), id: 'batch-a', fileName: first.sourceFile },
        { ...meta('statement'), id: 'batch-b', fileName: second.sourceFile },
      ],
      true,
      async (next) => { assert.equal(next.transactions.length, 2); }
    );
    assert.deepEqual(result, { added: 2, skipped: 0 });
  });

  it('recognises the same account after a PDF download is renamed', async () => {
    const original = { ...transaction('Current Account A', 'old'), sourceFile: 'statement.pdf' };
    const renamed = applyConfirmedPdfAccountLabels(
      [{ ...transaction('statement (1)', 'new'), sourceFile: 'statement (1).pdf', importBatchId: 'renamed' }],
      { renamed: 'Current Account A' }
    );
    const payload = { ...createEmptyVault(), transactions: [original], imports: [] };
    const result = await commitStatementImport(
      payload, renamed, [{ ...meta('statement (1)'), id: 'renamed', fileName: 'statement (1).pdf' }],
      false, async (next) => { assert.equal(next.transactions.length, 1); }
    );
    assert.deepEqual(result, { added: 0, skipped: 1 });
  });

  it('preserves repeated identical charges within one statement and skips both on reimport', async () => {
    const twoCharges = [transaction('Current Account A', 'charge-1'), transaction('Current Account A', 'charge-2')];
    const payload = { ...generateSample14MonthData(), transactions: [], imports: [] };
    let saved: VaultPayload = payload;
    const first = await commitStatementImport(
      payload, twoCharges, [meta('Current Account A')], true,
      async (next) => { saved = next; }
    );
    assert.deepEqual(first, { added: 2, skipped: 0 });
    assert.equal(saved.transactions.length, 2);
    assert.equal(hasImportReceipt(saved, [meta('Current Account A')]), true);
    const repeated = await commitStatementImport(
      saved, twoCharges, [meta('Current Account A')], false,
      async (next) => { assert.equal(next.transactions.length, 2); }
    );
    assert.deepEqual(repeated, { added: 0, skipped: 2 });
  });

  it('never merges fictional sample rows, goals or rules into a real import', async () => {
    const sample = generateSample14MonthData();
    assert.ok(sample.transactions.length > 0);
    assert.ok(sample.goals.length > 0);
    let saved: VaultPayload | undefined;
    await commitStatementImport(
      sample,
      [transaction('Real current account', 'real-1')],
      [meta('Real current account')],
      false,
      async (next) => { saved = next; }
    );
    assert.equal(saved?.isSampleData, false);
    assert.deepEqual(saved?.transactions.map((tx) => tx.id), ['real-1']);
    assert.deepEqual(saved?.goals, []);
    assert.deepEqual(saved?.categoryRules, []);
    assert.deepEqual(saved?.debts, []);
    assert.deepEqual(saved?.imports.map((entry) => entry.id), [meta('Real current account').id]);
  });

  it('starts a new vault without fictional transactions or goals', () => {
    const empty = createEmptyVault();
    assert.equal(empty.isSampleData, false);
    assert.deepEqual(empty.transactions, []);
    assert.deepEqual(empty.imports, []);
    assert.deepEqual(empty.goals, []);
    assert.deepEqual(empty.debts, []);
  });

  it('cleans an older mixed ledger without deleting real transactions', async () => {
    const sample = generateSample14MonthData();
    const priorReal = transaction('Real current account', 'real-prior');
    const mixed: VaultPayload = {
      ...sample,
      isSampleData: false,
      transactions: [sample.transactions[0], priorReal],
      imports: [sample.imports[0], meta('Real current account')],
    };
    let saved: VaultPayload | undefined;
    const result = await commitStatementImport(
      mixed,
      [transaction('Real savings account', 'real-new')],
      [meta('Real savings account')],
      false,
      async (next) => { saved = next; }
    );
    assert.deepEqual(saved?.transactions.map((tx) => tx.id).sort(), ['real-new', 'real-prior']);
    assert.equal(saved?.imports.some((entry) => entry.id.startsWith('sample-import-')), false);
    assert.deepEqual(saved?.goals, []);
    assert.deepEqual(saved?.debts, []);
    assert.deepEqual(saved?.categoryRules, []);
    assert.equal(result.legacySampleSettingsReview, true);
  });

  it('preserves user-edited settings that originated in an older mixed sample', async () => {
    const sample = generateSample14MonthData();
    const editedGoal = { ...sample.goals[0], name: 'My real emergency fund' };
    const mixed: VaultPayload = {
      ...sample,
      isSampleData: false,
      transactions: [sample.transactions[0], transaction('Real account', 'real-prior')],
      imports: [sample.imports[0], meta('Real account')],
      goals: [editedGoal],
      categoryCaps: { ...sample.categoryCaps },
      recurringActions: { ...sample.recurringActions },
    };
    let saved: VaultPayload | undefined;
    await commitStatementImport(
      mixed,
      [transaction('Other real account', 'real-new')],
      [meta('Other real account')],
      false,
      async (next) => { saved = next; }
    );
    assert.deepEqual(saved?.goals, [editedGoal]);
    assert.deepEqual(saved?.categoryCaps, mixed.categoryCaps);
    assert.deepEqual(saved?.recurringActions, mixed.recurringActions);
    assert.deepEqual(saved?.transactions.map((tx) => tx.id).sort(), ['real-new', 'real-prior']);
  });
});
