import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../src/types/finance';
import {
  applyBatchTransactionUpdate,
  describeParsedSearchFilters,
  matchesLedgerSearch,
  mergeTransactionTags,
  normalizeTransactionTag,
  parseLedgerSearchQuery,
  removeTransactionTag,
} from '../src/utils/ledgerFilters';
import { exportTransactionsToCsv } from '../src/utils/statementParser';

const SAMPLE_TXS: Transaction[] = [
  {
    id: 'tx-1',
    date: '2026-09-12',
    merchant: 'Waitrose',
    description: 'WAITROSE & PARTNERS LONDON',
    amount: -84.2,
    currency: 'GBP',
    category: 'groceries',
    spendingClass: 'essential',
    accountName: 'Current Account',
    tags: ['Shared', 'Weekly Shop'],
  },
  {
    id: 'tx-2',
    date: '2026-10-04',
    merchant: 'Trainline',
    description: 'TRAINLINE RAIL TICKET',
    amount: -42.5,
    currency: 'GBP',
    category: 'transport',
    spendingClass: 'essential',
    accountName: 'Current Account',
    tags: ['Work', 'Reimbursable'],
  },
  {
    id: 'tx-3',
    date: '2026-10-19',
    merchant: 'Pret A Manger',
    description: 'PRET COFFEE & LUNCH',
    amount: -11.75,
    currency: 'GBP',
    category: 'coffee_convenience',
    spendingClass: 'non-essential',
    accountName: 'Current Account',
    tags: ['Work'],
  },
  {
    id: 'tx-4',
    date: '2026-11-02',
    merchant: 'British Airways',
    description: 'BA FLIGHT BOOKING',
    amount: -320.0,
    currency: 'GBP',
    category: 'travel_holidays',
    spendingClass: 'non-essential',
    accountName: 'Credit Card',
    tags: ['Holiday'],
  },
];

describe('ledgerFilters & custom transaction tagging', () => {
  it('normalizes, merges (deduped case-insensitively), and removes custom tags', () => {
    assert.equal(normalizeTransactionTag('  ##Client   Dinner  '), 'Client Dinner');
    assert.equal(normalizeTransactionTag('   '), '');
    assert.equal(normalizeTransactionTag('A'.repeat(40)).length, 28);

    const merged = mergeTransactionTags(['Work'], 'work, Reimbursable, #Q4 Client');
    assert.deepEqual(merged, ['Work', 'Reimbursable', 'Q4 Client']);

    const afterRemove = removeTransactionTag(merged, 'reimbursable');
    assert.deepEqual(afterRemove, ['Work', 'Q4 Client']);
  });

  it('filters transactions by merchant name, date range, amount, and custom tags from search input', () => {
    // Merchant search
    const merchantQuery = parseLedgerSearchQuery('waitrose');
    const merchantHits = SAMPLE_TXS.filter((tx) => matchesLedgerSearch(tx, merchantQuery, 'GBP'));
    assert.deepEqual(
      merchantHits.map((t) => t.id),
      ['tx-1']
    );

    // Date range search (YYYY-MM-DD..YYYY-MM-DD)
    const dateRangeQuery = parseLedgerSearchQuery('2026-10-01..2026-10-31');
    const dateHits = SAMPLE_TXS.filter((tx) => matchesLedgerSearch(tx, dateRangeQuery, 'GBP'));
    assert.deepEqual(
      dateHits.map((t) => t.id),
      ['tx-2', 'tx-3']
    );

    // Natural "to" date range + amount comparator
    const combinedQuery = parseLedgerSearchQuery('2026-09-01 to 2026-10-31 >40');
    const combinedHits = SAMPLE_TXS.filter((tx) => matchesLedgerSearch(tx, combinedQuery, 'GBP'));
    assert.deepEqual(
      combinedHits.map((t) => t.id),
      ['tx-1', 'tx-2']
    );

    // Amount range (min..max)
    const amtRangeQuery = parseLedgerSearchQuery('£10..£50');
    const amtRangeHits = SAMPLE_TXS.filter((tx) => matchesLedgerSearch(tx, amtRangeQuery, 'GBP'));
    assert.deepEqual(
      amtRangeHits.map((t) => t.id),
      ['tx-2', 'tx-3']
    );

    // Exact currency-prefixed amount
    const exactAmtQuery = parseLedgerSearchQuery('£42.50');
    const exactAmtHits = SAMPLE_TXS.filter((tx) => matchesLedgerSearch(tx, exactAmtQuery, 'GBP'));
    assert.deepEqual(
      exactAmtHits.map((t) => t.id),
      ['tx-2']
    );

    // Custom #tag + amount filter
    const tagQuery = parseLedgerSearchQuery('#work <20');
    const tagHits = SAMPLE_TXS.filter((tx) => matchesLedgerSearch(tx, tagQuery, 'GBP'));
    assert.deepEqual(
      tagHits.map((t) => t.id),
      ['tx-3']
    );

    // Human-readable parsed filter badges
    const badges = describeParsedSearchFilters(
      parseLedgerSearchQuery('from:2026-10-01 to:2026-10-31 >=40 #work'),
      'GBP'
    );
    assert.deepEqual(badges, ['Dates: 2026-10-01 → 2026-10-31', 'Amount ≥ £40', '#work']);
  });

  it('includes CustomTags column in exported CSV ledger', () => {
    const csv = exportTransactionsToCsv(SAMPLE_TXS, 'GBP');
    assert.ok(csv.includes(',SmartTags,CustomTags,Account,'));
    assert.ok(csv.includes('"Work; Reimbursable"'));
    assert.ok(csv.includes('"Shared; Weekly Shop"'));
  });

  it('batch updates categories and tags across multiple selected transactions cleanly', () => {
    const selected = new Set(['tx-2', 'tx-3']);
    const { transactions: updated, updatedCount } = applyBatchTransactionUpdate(
      SAMPLE_TXS,
      selected,
      {
        category: 'dining_takeaway',
        addTag: 'Client Trip',
      }
    );

    assert.equal(updatedCount, 2);
    // Unselected transactions remain untouched
    assert.equal(updated[0].category, 'groceries');
    assert.deepEqual(updated[0].tags, ['Shared', 'Weekly Shop']);
    // Selected transactions get updated category, default spendingClass, and merged custom tag
    assert.equal(updated[1].category, 'dining_takeaway');
    assert.equal(updated[1].spendingClass, 'non-essential');
    assert.deepEqual(updated[1].tags, ['Work', 'Reimbursable', 'Client Trip']);
    assert.equal(updated[2].category, 'dining_takeaway');
    assert.deepEqual(updated[2].tags, ['Work', 'Client Trip']);

    // Batch remove tag
    const removed = applyBatchTransactionUpdate(updated, selected, {
      removeTag: 'work',
    });
    assert.equal(removed.updatedCount, 2);
    assert.deepEqual(removed.transactions[1].tags, ['Reimbursable', 'Client Trip']);
    assert.deepEqual(removed.transactions[2].tags, ['Client Trip']);
  });
});
