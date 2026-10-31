import type { SyncMeta } from '../domain/types';
import { compareRecords, type AppData } from '../store';

/** The backup file: every record, tombstones included. Never holds credentials. */
export interface Snapshot extends AppData {
  version: 1;
  /** ms since epoch. */
  exportedAt: number;
}

export function toSnapshot(records: AppData, exportedAt: number): Snapshot {
  return {
    version: 1,
    exportedAt,
    entries: records.entries,
    bodyweights: records.bodyweights,
    customExercises: records.customExercises,
    notes: records.notes,
  };
}

export function emptySnapshot(): Snapshot {
  return toSnapshot({ entries: [], bodyweights: [], customExercises: [], notes: [] }, 0);
}

function union<T extends SyncMeta>(a: T[], b: T[], keyOf: (record: T) => string): T[] {
  const winners = new Map<string, T>();
  for (const record of [...a, ...b]) {
    const held = winners.get(keyOf(record));
    if (!held || compareRecords(record, held) > 0) winners.set(keyOf(record), record);
  }
  // Codepoint order, not locale order, so every device writes the same file.
  return [...winners.values()].sort((x, y) => (keyOf(x) < keyOf(y) ? -1 : 1));
}

/**
 * Keeps the winning version of every record, tombstones included. Pure, and
 * order-independent: output order and `exportedAt` depend only on the contents.
 */
export function merge(a: Snapshot, b: Snapshot): Snapshot {
  return {
    version: 1,
    exportedAt: Math.max(a.exportedAt, b.exportedAt),
    entries: union(a.entries, b.entries, (entry) => entry.id),
    bodyweights: union(a.bodyweights, b.bodyweights, (record) => record.date),
    customExercises: union(a.customExercises, b.customExercises, (exercise) => exercise.id),
    notes: union(a.notes, b.notes, (note) => note.exerciseId),
  };
}

function sameList(a: SyncMeta[], b: SyncMeta[]): boolean {
  return a.length === b.length && a.every((record, i) => compareRecords(record, b[i]) === 0);
}

/** True when both hold the same records, whatever their order or `exportedAt`. */
export function sameRecords(a: Snapshot, b: Snapshot): boolean {
  const [x, y] = [merge(a, a), merge(b, b)];
  return (
    sameList(x.entries, y.entries) &&
    sameList(x.bodyweights, y.bodyweights) &&
    sameList(x.customExercises, y.customExercises) &&
    sameList(x.notes, y.notes)
  );
}
