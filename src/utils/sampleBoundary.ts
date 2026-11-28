import type { VaultPayload } from '../types/finance';
import { generateSample14MonthData } from './sampleData';

function withoutUnchangedSampleItems<T extends { id: string }>(
  items: T[] | undefined,
  sampleItems: T[] | undefined
): T[] {
  const samplesById = new Map((sampleItems ?? []).map((item) => [item.id, item]));
  // The fixture stamps some rows with the time it was loaded; that timestamp
  // cannot be regenerated later, so compare the substantive fields only.
  const comparable = (item: T) => JSON.stringify(
    Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'updatedAt'))
  );
  return (items ?? []).filter((item) => {
    const sample = samplesById.get(item.id);
    return !sample || comparable(item) !== comparable(sample);
  });
}

/**
 * Older releases allowed real rows to be merged with the built-in sample while
 * setting isSampleData=false. Remove only recognisable sample artefacts when a
 * later real import arrives; leave the user's real rows and custom settings.
 */
export function stripLegacySampleArtifacts(payload: VaultPayload): VaultPayload {
  if (payload.isSampleData) return payload;

  const sample = generateSample14MonthData();
  const sampleIds = new Set(sample.transactions.map((tx) => tx.id));
  const sampleBatchIds = new Set(sample.imports.map((entry) => entry.id));
  const sampleSources = new Set(sample.transactions.map((tx) => tx.sourceFile));
  const isSampleRow = (tx: VaultPayload['transactions'][number]) =>
    sampleIds.has(tx.id) &&
    (sampleBatchIds.has(tx.importBatchId ?? '') || sampleSources.has(tx.sourceFile));

  if (
    !payload.transactions.some(isSampleRow) &&
    !payload.imports.some((entry) => sampleBatchIds.has(entry.id))
  ) return payload;

  return {
    ...payload,
    transactions: payload.transactions.filter((tx) => !isSampleRow(tx)),
    imports: payload.imports.filter((entry) => !sampleBatchIds.has(entry.id)),
    goals: withoutUnchangedSampleItems(payload.goals, sample.goals),
    debts: withoutUnchangedSampleItems(payload.debts, sample.debts),
    categoryRules: withoutUnchangedSampleItems(payload.categoryRules, sample.categoryRules),
    advancedRules: withoutUnchangedSampleItems(payload.advancedRules, sample.advancedRules),
    // A sample key/value may also be an intentional user choice. Preserve
    // recurring actions, caps, overrides, planner text and ISA settings unless
    // the owner explicitly changes them in Settings.
    plannerState: payload.plannerState && {
      ...payload.plannerState,
      struggles: withoutUnchangedSampleItems(payload.plannerState.struggles, sample.plannerState?.struggles),
      plannerGoals: withoutUnchangedSampleItems(payload.plannerState.plannerGoals, sample.plannerState?.plannerGoals),
    },
  };
}
