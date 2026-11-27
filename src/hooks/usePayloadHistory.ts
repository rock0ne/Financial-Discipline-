import { useCallback, useRef, useState } from 'react';
import type { VaultPayload } from '../types/finance';

export interface PayloadHistoryEntry {
  payload: VaultPayload;
  label: string;
  timestamp: number;
  coalesceKey?: string;
}

interface PayloadHistoryState {
  past: PayloadHistoryEntry[];
  present: VaultPayload | null;
  presentLabel: string | null;
  presentCoalesceKey?: string;
  presentTimestamp: number;
  future: PayloadHistoryEntry[];
}

export interface CommitHistoryOptions {
  label?: string;
  recordHistory?: boolean;
  coalesceKey?: string;
}

const MAX_HISTORY_ENTRIES = 40;
const COALESCE_WINDOW_MS = 750;

const INITIAL_STATE: PayloadHistoryState = {
  past: [],
  present: null,
  presentLabel: null,
  presentCoalesceKey: undefined,
  presentTimestamp: 0,
  future: [],
};

/**
 * Global Undo/Redo state manager for the main VaultPayload.
 * Keeps a bounded in-memory history stack that clears automatically when
 * the vault is locked, shredded, or freshly unlocked.
 */
export function usePayloadHistory() {
  const [state, setState] = useState<PayloadHistoryState>(INITIAL_STATE);
  const stateRef = useRef<PayloadHistoryState>(INITIAL_STATE);

  const applyState = useCallback((next: PayloadHistoryState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Initialize or wipe present payload and clear all undo/redo history (load, unlock, lock, shred) */
  const resetPresent = useCallback(
    (nextPayload: VaultPayload | null) => {
      applyState({
        past: [],
        present: nextPayload,
        presentLabel: null,
        presentCoalesceKey: undefined,
        presentTimestamp: Date.now(),
        future: [],
      });
    },
    [applyState]
  );

  /** Commit a new payload snapshot, optionally recording the previous state in the undo stack */
  const commit = useCallback(
    (nextPayload: VaultPayload, options: CommitHistoryOptions = {}) => {
      const { label = 'Vault change', recordHistory = true, coalesceKey } = options;
      const cur = stateRef.current;
      const now = Date.now();

      if (!recordHistory || !cur.present) {
        applyState({
          ...cur,
          present: nextPayload,
          presentLabel: cur.present ? cur.presentLabel : null,
          presentTimestamp: now,
        });
        return;
      }

      // Coalesce rapid consecutive updates with the same key (e.g. range sliders) into one undo step
      const shouldCoalesce =
        Boolean(coalesceKey) &&
        cur.presentCoalesceKey === coalesceKey &&
        now - cur.presentTimestamp <= COALESCE_WINDOW_MS &&
        cur.past.length > 0;

      if (shouldCoalesce) {
        applyState({
          ...cur,
          present: nextPayload,
          presentLabel: label,
          presentCoalesceKey: coalesceKey,
          presentTimestamp: now,
          future: [],
        });
        return;
      }

      const nextPast: PayloadHistoryEntry[] = [
        ...cur.past,
        {
          payload: cur.present,
          label: cur.presentLabel ?? 'Initial state',
          timestamp: cur.presentTimestamp || now,
          coalesceKey: cur.presentCoalesceKey,
        },
      ].slice(-MAX_HISTORY_ENTRIES);

      applyState({
        past: nextPast,
        present: nextPayload,
        presentLabel: label,
        presentCoalesceKey: coalesceKey,
        presentTimestamp: now,
        future: [],
      });
    },
    [applyState]
  );

  /** Step backward one snapshot and return the restored payload + action label */
  const undo = useCallback((): { payload: VaultPayload; undoneLabel: string } | null => {
    const cur = stateRef.current;
    if (!cur.present || cur.past.length === 0) return null;

    const previous = cur.past[cur.past.length - 1];
    const nextPast = cur.past.slice(0, -1);
    const undoneLabel = cur.presentLabel ?? 'Last change';

    const nextFuture: PayloadHistoryEntry[] = [
      {
        payload: cur.present,
        label: undoneLabel,
        timestamp: Date.now(),
      },
      ...cur.future,
    ].slice(0, MAX_HISTORY_ENTRIES);

    applyState({
      past: nextPast,
      present: previous.payload,
      presentLabel: nextPast.length > 0 ? previous.label : null,
      presentCoalesceKey: undefined,
      presentTimestamp: Date.now(),
      future: nextFuture,
    });

    return { payload: previous.payload, undoneLabel };
  }, [applyState]);

  /** Step forward one snapshot and return the restored payload + action label */
  const redo = useCallback((): { payload: VaultPayload; redoneLabel: string } | null => {
    const cur = stateRef.current;
    if (!cur.present || cur.future.length === 0) return null;

    const nextEntry = cur.future[0];
    const nextFuture = cur.future.slice(1);
    const redoneLabel = nextEntry.label;

    const nextPast: PayloadHistoryEntry[] = [
      ...cur.past,
      {
        payload: cur.present,
        label: cur.presentLabel ?? 'Previous state',
        timestamp: Date.now(),
      },
    ].slice(-MAX_HISTORY_ENTRIES);

    applyState({
      past: nextPast,
      present: nextEntry.payload,
      presentLabel: redoneLabel,
      presentCoalesceKey: undefined,
      presentTimestamp: Date.now(),
      future: nextFuture,
    });

    return { payload: nextEntry.payload, redoneLabel };
  }, [applyState]);

  return {
    payload: state.present,
    canUndo: state.past.length > 0 && state.present !== null,
    canRedo: state.future.length > 0 && state.present !== null,
    undoCount: state.past.length,
    redoCount: state.future.length,
    lastUndoLabel: state.past.length > 0 ? state.presentLabel ?? 'Last change' : null,
    nextRedoLabel: state.future.length > 0 ? state.future[0].label : null,
    resetPresent,
    commit,
    undo,
    redo,
  };
}
