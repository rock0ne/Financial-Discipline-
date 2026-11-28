import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSample14MonthData } from '../src/utils/sampleData';
import {
  applyConfirmedPdfAccountLabels,
  commitStatementImport,
  effectiveReplaceExisting,
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
  it('forces replacement only while the sample ledger is active', () => {
    assert.equal(effectiveReplaceExisting(true, false), true);
    assert.equal(effectiveReplaceExisting(true, true), true);
    assert.equal(effectiveReplaceExisting(false, false), false);
    assert.equal(effectiveReplaceExisting(false, true), true);
  });

  it('always removes fictional transactions and import receipts on the first real import, even if merge was requested', async () => {
    const sample = generateSample14MonthData();
    assert.equal(sample.isSampleData, true);
    assert.ok(sample.transactions.length > 0);
    assert.ok(sample.imports.length > 0);
    const firstReal = transaction('account-a', 'first-real');
    const firstMeta = meta('account-a');
    let saved: VaultPayload = sample;

    const firstResult = await commitStatementImport(
      sample,
      [firstReal],
      [firstMeta],
      false,
      async (next) => { saved = next; }
    );
    assert.deepEqual(firstResult, { added: 1, skipped: 0 });
    assert.equal(saved.isSampleData, false);
    assert.deepEqual(saved.transactions, [firstReal]);
    assert.deepEqual(saved.imports, [firstMeta]);
    assert.equal(hasImportReceipt(saved, [firstMeta]), true);
    assert.equal(hasImportReceipt(saved, [sample.imports[0]]), false);
    assert.equal(saved.plannerState, sample.plannerState); // unrelated vault work is retained

    const secondReal = transaction('account-b', 'second-real');
    const secondMeta = meta('account-b');
    const secondResult = await commitStatementImport(
      saved,
      [secondReal],
      [secondMeta],
      false,
      async (next) => { saved = next; }
    );
    assert.deepEqual(secondResult, { added: 1, skipped: 0 });
    assert.deepEqual(new Set(saved.transactions.map((tx) => tx.id)), new Set(['first-real', 'second-real']));
    assert.deepEqual(new Set(saved.imports.map((entry) => entry.id)), new Set([firstMeta.id, secondMeta.id]));
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
      ...generateSample14MonthData(),
      isSampleData: false,
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
    const payload = { ...generateSample14MonthData(), isSampleData: false, transactions: [original], imports: [] };
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
});
