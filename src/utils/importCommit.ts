import type {
  StatementImportMeta,
  Transaction,
  VaultPayload,
} from '../types/finance';
import { buildDedupKey } from './statementParser';

export interface ImportCommitResult {
  added: number;
  skipped: number;
}

export function effectiveReplaceExisting(isSampleData: boolean, requestedReplace: boolean): boolean {
  return isSampleData || requestedReplace;
}

export function isValidPdfAccountLabel(label: string | undefined): boolean {
  const value = label?.trim() ?? '';
  return value.length >= 2 && value.length <= 64 && !/[|\r\n]/.test(value);
}

export function applyConfirmedPdfAccountLabels(
  transactions: Transaction[],
  labelsByBatchId: Record<string, string>
): Transaction[] {
  return transactions.map((tx) => {
    if (!tx.sourceFile?.toLowerCase().endsWith('.pdf')) return tx;
    const label = tx.importBatchId ? labelsByBatchId[tx.importBatchId] : undefined;
    if (!isValidPdfAccountLabel(label)) {
      throw new Error('Each PDF needs a confirmed stable account label');
    }
    return { ...tx, accountName: label!.trim() };
  });
}

export function hasImportReceipt(
  payload: VaultPayload,
  metas: StatementImportMeta[]
): boolean {
  if (metas.length === 0) return false;
  const savedIds = new Set(payload.imports.map((meta) => meta.id));
  return metas.every((meta) => savedIds.has(meta.id));
}

export async function commitStatementImport(
  payload: VaultPayload,
  incoming: Transaction[],
  metas: StatementImportMeta[],
  replaceExisting: boolean,
  save: (next: VaultPayload, label: string) => Promise<void>
): Promise<ImportCommitResult> {
  // A first real import must never coexist with the built-in fictional ledger,
  // even if an older UI or caller submits replaceExisting=false.
  const shouldReplace = effectiveReplaceExisting(payload.isSampleData, replaceExisting);
  const baseTx = shouldReplace ? [] : payload.transactions;
  const existingCounts = new Map<string, number>();
  for (const tx of baseTx) {
    const key = buildDedupKey(tx);
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }

  // A statement may contain two genuine same-day, same-amount charges. Preserve
  // that within-file occurrence count, while treating overlapping files as
  // alternative copies of the same account/date/description/amount group.
  const sourceCounts = new Map<string, Map<string, number>>();
  for (const tx of incoming) {
    const key = buildDedupKey(tx);
    const source = tx.importBatchId ?? tx.sourceFile ?? 'selected-batch';
    const perSource = sourceCounts.get(key) ?? new Map<string, number>();
    perSource.set(source, (perSource.get(source) ?? 0) + 1);
    sourceCounts.set(key, perSource);
  }
  const allowedNew = new Map<string, number>();
  for (const [key, perSource] of sourceCounts) {
    const largestStatementCount = Math.max(...perSource.values());
    allowedNew.set(key, Math.max(0, largestStatementCount - (existingCounts.get(key) ?? 0)));
  }
  const acceptedCounts = new Map<string, number>();
  const uniqueIncoming: Transaction[] = [];
  let skipped = 0;
  const addedByBatch = new Map<string, Transaction[]>();
  const skippedByBatch = new Map<string, number>();

  for (const tx of incoming) {
    const key = buildDedupKey(tx);
    const batchKey = tx.importBatchId ?? tx.sourceFile ?? '';
    if ((acceptedCounts.get(key) ?? 0) >= (allowedNew.get(key) ?? 0)) {
      skipped++;
      if (batchKey) {
        skippedByBatch.set(batchKey, (skippedByBatch.get(batchKey) ?? 0) + 1);
      }
    } else {
      acceptedCounts.set(key, (acceptedCounts.get(key) ?? 0) + 1);
      uniqueIncoming.push(tx);
      if (batchKey) {
        const list = addedByBatch.get(batchKey) ?? [];
        list.push(tx);
        addedByBatch.set(batchKey, list);
      }
    }
  }

  const enrichedMetas: StatementImportMeta[] = metas.map((meta) => {
    const addedList = addedByBatch.get(meta.id) ?? addedByBatch.get(meta.fileName);
    const skippedCount = skippedByBatch.get(meta.id) ?? skippedByBatch.get(meta.fileName) ?? 0;
    if (!addedList && skippedCount === 0) return meta;
    const dates = (addedList ?? []).map((tx) => tx.date).sort();
    return {
      ...meta,
      rowCount: addedList?.length ?? 0,
      duplicatesSkipped: skippedCount,
      dateRangeStart: dates[0] ?? meta.dateRangeStart,
      dateRangeEnd: dates[dates.length - 1] ?? meta.dateRangeEnd,
    };
  });

  const merged = [...uniqueIncoming, ...baseTx].sort((a, b) =>
    b.date.localeCompare(a.date)
  );
  const next: VaultPayload = {
    ...payload,
    isSampleData: false,
    transactions: merged,
    imports: shouldReplace ? enrichedMetas : [...enrichedMetas, ...payload.imports],
  };
  const label = `Imported ${uniqueIncoming.length} transaction${uniqueIncoming.length === 1 ? '' : 's'}`;
  // The callback must resolve only after the local vault write is durable.
  await save(next, label);
  return { added: uniqueIncoming.length, skipped };
}
