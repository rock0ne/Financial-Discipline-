import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLocalAlertDeliveryState,
  genericNotificationCopy,
  hasLocalAlertReceipt,
  osAlertsOptedIn,
  recordLocalAlertReceipt,
  reminderNeedsReplacement,
  setOsAlertsOptIn,
} from '../src/utils/localAlertDelivery';

const stored = new Map<string, string>();
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value); },
  removeItem: (key: string) => { stored.delete(key); },
};

describe('local alert delivery privacy and receipts', () => {
  it('deduplicates one period and clears receipts plus opt-in on shred', () => {
    Object.assign(globalThis, { localStorage: storage });
    stored.clear();
    setOsAlertsOptIn(true);
    assert.equal(osAlertsOptedIn(), true);
    const key = 'private-rule:2026-11';
    assert.equal(hasLocalAlertReceipt(key), false);
    recordLocalAlertReceipt(key);
    assert.equal(hasLocalAlertReceipt(key), true);
    assert.equal(hasLocalAlertReceipt('private-rule:2026-12'), false);
    assert.equal(clearLocalAlertDeliveryState(), true);
    assert.equal(hasLocalAlertReceipt(key), false);
    assert.equal(osAlertsOptedIn(), false);
  });

  it('reports unconfirmed cleanup when device preference removal fails', () => {
    Object.assign(globalThis, { localStorage: storage });
    stored.clear();
    setOsAlertsOptIn(true);
    Object.assign(globalThis, { localStorage: {
      ...storage,
      removeItem: () => { throw new Error('storage blocked'); },
    } });
    assert.equal(clearLocalAlertDeliveryState(), false);
    assert.equal(osAlertsOptedIn(), true);
    Object.assign(globalThis, { localStorage: storage });
    stored.clear();
  });

  it('cannot claim an opt-in when device preference storage rejects writes', () => {
    Object.assign(globalThis, { localStorage: { ...storage, setItem: () => { throw new Error('quota denied'); } } });
    stored.clear();
    setOsAlertsOptIn(true);
    assert.equal(osAlertsOptedIn(), false);
    Object.assign(globalThis, { localStorage: storage });
  });

  it('exposes a failed opt-out readback so the caller can warn about system settings', () => {
    Object.assign(globalThis, { localStorage: storage });
    stored.clear();
    setOsAlertsOptIn(true);
    Object.assign(globalThis, { localStorage: { ...storage, removeItem: () => { throw new Error('write denied'); } } });
    setOsAlertsOptIn(false);
    assert.equal(osAlertsOptedIn(), true);
    Object.assign(globalThis, { localStorage: storage });
    stored.clear();
  });

  it('uses the same generic copy regardless of private labels, amounts and categories', () => {
    const privateInputs = ['Mortgage £1,245.00', 'groceries', 'Account 1234', 'Example Merchant'];
    const copy = genericNotificationCopy();
    assert.deepEqual(copy, {
      title: 'Clearledger alert',
      body: 'Open Clearledger to review your local alert.',
    });
    for (const value of privateInputs) assert.equal(JSON.stringify(copy).includes(value), false);
  });

  it('replaces a pending reminder when its time changes', () => {
    const oldAt = new Date('2026-11-30T10:00:00.000Z');
    const newAt = new Date('2026-11-30T11:00:00.000Z');
    assert.equal(reminderNeedsReplacement(oldAt.toISOString(), oldAt), false);
    assert.equal(reminderNeedsReplacement(oldAt.toISOString(), newAt), true);
    assert.equal(reminderNeedsReplacement(undefined, newAt), true);
  });
});
