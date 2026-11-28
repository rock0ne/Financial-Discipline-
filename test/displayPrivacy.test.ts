import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactImportDisplayText } from '../src/utils/displayPrivacy';
import { exportTransactionsToCsv } from '../src/utils/statementParser';
import type { Transaction } from '../src/types/finance';

describe('statement path privacy', () => {
  it('masks account-number-like runs in nested PDF paths', () => {
    const source = 'statements/Account 12345678/Sort 60-04-20/Statement 9876 5432.pdf';
    const safe = redactImportDisplayText(source);
    assert.equal(safe, 'statements/Account [number redacted]/Sort [number redacted]/Statement [number redacted].pdf');
    const transaction: Transaction = {
      id: 'synthetic-1',
      date: '2026-11-01',
      description: 'Synthetic Grocery',
      merchant: 'Synthetic Grocery',
      amount: -12.34,
      currency: 'GBP',
      category: 'groceries',
      spendingClass: 'essential',
      accountName: 'Everyday current account',
      sourceFile: safe,
    };
    const csv = exportTransactionsToCsv([transaction], 'GBP');
    assert.doesNotMatch(csv, /12345678|60-04-20|9876 5432/);
    assert.match(csv, /\[number redacted\]/);
  });
});
