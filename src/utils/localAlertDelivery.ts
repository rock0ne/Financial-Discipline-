import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { LocalAlertRule } from '../types/finance';
import { normalizeLocalAlertRules, notificationId } from './localAlerts';

const OPT_IN_KEY = 'clearledger_local_alert_os_opt_in_v1';
const RECEIPTS_KEY = 'clearledger_local_alert_receipts_v1';
const SOURCE = 'clearledger-local-alerts-v1';
const GENERIC_TITLE = 'Clearledger alert';
const GENERIC_BODY = 'Open Clearledger to review your local alert.';
const MAX_RECEIPTS = 256;
let deliveryEpoch = 0;
let androidQueue: Promise<void> = Promise.resolve();

function queueAndroid<T>(work: () => Promise<T>): Promise<T> {
  const next = androidQueue.then(work, work);
  androidQueue = next.then(() => undefined, () => undefined);
  return next;
}

/** The only renderer-supplied Android notification text. No rule or ledger data enters it. */
export function genericNotificationCopy(): { title: string; body: string } {
  return { title: GENERIC_TITLE, body: GENERIC_BODY };
}

interface DesktopNotificationBridge {
  isDesktopApp?: boolean;
  showLocalNotification?: () => Promise<boolean>;
  supportsLocalNotification?: () => Promise<boolean>;
}

function desktopBridge(): DesktopNotificationBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { clearledgerDesktop?: DesktopNotificationBridge }).clearledgerDesktop;
}

export function localAlertPlatform(): 'android' | 'desktop' | 'none' {
  if (Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform()) return 'android';
  if (desktopBridge()?.isDesktopApp) return 'desktop';
  return 'none';
}

export function osAlertsOptedIn(): boolean {
  try {
    return localStorage.getItem(OPT_IN_KEY) === 'enabled';
  } catch {
    return false;
  }
}

/** Returns false when the device preference write/readback cannot be confirmed. */
export function setOsAlertsOptIn(enabled: boolean): boolean {
  if (!enabled) deliveryEpoch += 1;
  try {
    if (enabled) localStorage.setItem(OPT_IN_KEY, 'enabled');
    else localStorage.removeItem(OPT_IN_KEY);
    return (localStorage.getItem(OPT_IN_KEY) === 'enabled') === enabled;
  } catch {
    // Device preference storage can be unavailable; callers must not infer consent.
    return false;
  }
}

export function loadLocalAlertReceipts(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? '[]');
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((item): item is string =>
      typeof item === 'string' && /^[A-Za-z0-9_-]{1,80}:(?:\d{4}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/.test(item)
    ).slice(-MAX_RECEIPTS));
  } catch {
    return new Set();
  }
}

export function recordLocalAlertReceipt(receiptKey: string): void {
  const receipts = loadLocalAlertReceipts();
  receipts.add(receiptKey);
  try {
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify([...receipts].slice(-MAX_RECEIPTS)));
  } catch {
    // A failed receipt write must not permit repeated notifications this run.
    volatileReceipts.add(receiptKey);
  }
}

const volatileReceipts = new Set<string>();

export function hasLocalAlertReceipt(receiptKey: string): boolean {
  return volatileReceipts.has(receiptKey) || loadLocalAlertReceipts().has(receiptKey);
}

/** False means local opt-out/receipt removal could not be confirmed. */
export function clearLocalAlertDeliveryState(): boolean {
  deliveryEpoch += 1;
  volatileReceipts.clear();
  let cleared = true;
  try {
    localStorage.removeItem(RECEIPTS_KEY);
  } catch {
    cleared = false;
  }
  try {
    localStorage.removeItem(OPT_IN_KEY);
  } catch {
    cleared = false;
  }
  try {
    return cleared && localStorage.getItem(OPT_IN_KEY) !== 'enabled';
  } catch {
    return false;
  }
}

export async function requestOsAlertOptIn(): Promise<boolean> {
  const platform = localAlertPlatform();
  if (platform === 'none') return false;
  if (platform === 'android') {
    const current = await LocalNotifications.checkPermissions();
    const status = current.display === 'granted'
      ? current
      : await LocalNotifications.requestPermissions();
    return status.display === 'granted';
  }
  return await desktopBridge()?.supportsLocalNotification?.() === true;
}

export async function showGenericLocalNotification(ruleId: string, purpose: 'trigger' | 'reminder'): Promise<boolean> {
  if (!osAlertsOptedIn()) return false;
  const platform = localAlertPlatform();
  if (platform === 'android') {
    const epoch = deliveryEpoch;
    return queueAndroid(async () => {
      if (epoch !== deliveryEpoch || !osAlertsOptedIn()) return false;
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== 'granted' || epoch !== deliveryEpoch || !osAlertsOptedIn()) return false;
      const id = notificationId(ruleId, purpose);
      await LocalNotifications.schedule({ notifications: [{
        id, ...genericNotificationCopy(), isExactNotification: false,
        extra: { source: SOURCE, purpose },
      }] });
      if (epoch !== deliveryEpoch || !osAlertsOptedIn()) {
        await LocalNotifications.cancel({ notifications: [{ id }] });
        return false;
      }
      return true;
    });
  }
  if (platform === 'desktop') {
    const epoch = deliveryEpoch;
    if (!osAlertsOptedIn()) return false;
    const result = await desktopBridge()?.showLocalNotification?.() === true;
    return result && epoch === deliveryEpoch && osAlertsOptedIn();
  }
  return false;
}

export function reminderNeedsReplacement(pendingAt: unknown, desiredAt: Date): boolean {
  const actual = pendingAt instanceof Date ? pendingAt : new Date(String(pendingAt ?? ''));
  return actual.getTime() !== desiredAt.getTime();
}

/** Reconcile only our own Android reminder alarms. No exact alarm permission is used. */
async function reconcileDateReminders(rawRules: unknown, optedIn: boolean, now: Date): Promise<void> {
  if (localAlertPlatform() !== 'android') return;
  const pending = (await LocalNotifications.getPending()).notifications;
  const managed = pending.filter((item) => item.extra?.source === SOURCE && item.extra?.purpose === 'reminder');
  const permission = optedIn ? await LocalNotifications.checkPermissions() : null;
  const enabled = optedIn && osAlertsOptedIn() && permission?.display === 'granted';
  const desired = new Map<number, Date>();
  if (enabled) {
    for (const rule of normalizeLocalAlertRules(rawRules)) {
      if (rule.kind !== 'date_reminder' || !rule.enabled) continue;
      const at = new Date(rule.at);
      if (at.getTime() <= now.getTime()) continue;
      desired.set(notificationId(rule.id, 'reminder'), at);
    }
  }
  const cancelled = managed.filter((item) => {
    const due = desired.get(item.id);
    return !due || reminderNeedsReplacement(item.schedule?.at, due);
  });
  if (cancelled.length) await LocalNotifications.cancel({ notifications: cancelled.map(({ id }) => ({ id })) });
  const cancelledIds = new Set(cancelled.map(({ id }) => id));
  const existing = new Set(managed.filter(({ id }) => !cancelledIds.has(id)).map(({ id }) => id));
  const missing = [...desired].filter(([id]) => !existing.has(id));
  if (missing.length) {
    if (!osAlertsOptedIn()) return;
    await LocalNotifications.schedule({ notifications: missing.map(([id, at]) => ({
      id, ...genericNotificationCopy(),
      schedule: { at }, isExactNotification: false,
      extra: { source: SOURCE, purpose: 'reminder' },
    })) });
  }
}

export function syncScheduledDateReminders(rawRules: unknown, optedIn: boolean, now: Date = new Date()): Promise<void> {
  if (localAlertPlatform() !== 'android') return Promise.resolve();
  return queueAndroid(() => reconcileDateReminders(rawRules, optedIn, now));
}

/** Opt-out cleanup only targets this feature's own pending Android notifications. */
export function cancelAllManagedLocalNotifications(): Promise<void> {
  if (localAlertPlatform() !== 'android') return Promise.resolve();
  return queueAndroid(async () => {
    const pending = (await LocalNotifications.getPending()).notifications;
    const managed = pending.filter((item) => item.extra?.source === SOURCE);
    if (managed.length) {
      await LocalNotifications.cancel({ notifications: managed.map(({ id }) => ({ id })) });
    }
  });
}
