import { useSyncExternalStore } from 'react';
import type {
  Bodyweight,
  CustomExercise,
  Entry,
  ExerciseDef,
  ExerciseNote,
  ISODate,
  SyncMeta,
} from '../domain/types';
import { KEY_PATHS, transact } from './db';

export interface AppData {
  entries: Entry[];
  bodyweights: Bodyweight[];
  customExercises: CustomExercise[];
  notes: ExerciseNote[];
}

type Collection = keyof AppData;
type StoredRecord = AppData[Collection][number];
type Changes = Partial<Record<Collection, StoredRecord[]>>;

const COLLECTIONS: Collection[] = ['entries', 'bodyweights', 'customExercises', 'notes'];
const DIRTY_KEY = 'dirty';

// Every record, tombstones included. IndexedDB holds the same data durably.
const memory: Record<Collection, Map<string, StoredRecord>> = {
  entries: new Map(),
  bodyweights: new Map(),
  customExercises: new Map(),
  notes: new Map(),
};

let view: AppData | null = null;
let dirty = false;
let revision = 0;
let lastStamp = 0;
let loading: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const listeners = new Set<() => void>();
const writeListeners = new Set<() => void>();

function keyOf(name: Collection, record: StoredRecord): string {
  return (record as unknown as Record<string, string>)[KEY_PATHS[name]];
}

/**
 * Total order on versions of one record: newest first, then content, so that
 * merging is order-independent even when two versions share a timestamp.
 * Returns 0 only for identical content.
 */
export function compareRecords(a: SyncMeta, b: SyncMeta): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
  const [x, y] = [canonical(a), canonical(b)];
  return x < y ? -1 : x > y ? 1 : 0;
}

function canonical(record: object): string {
  return JSON.stringify(record, Object.keys(record).sort());
}

/** Strictly increasing, and always ahead of every stored record, so an edit beats the version it replaces. */
function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

function liveRows(name: Collection): StoredRecord[] {
  const rows = [...memory[name].values()].filter((record) => !record.deleted);
  if (name === 'entries') {
    const entries = rows as Entry[];
    return entries.sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt);
  }
  return rows.sort((a, b) => keyOf(name, a).localeCompare(keyOf(name, b)));
}

function absorb(names: Collection[], changes: Changes): void {
  for (const name of names) {
    for (const record of changes[name] ?? []) {
      memory[name].set(keyOf(name, record), record);
      lastStamp = Math.max(lastStamp, record.updatedAt);
    }
  }
  // Untouched collections keep their array, so consumers can memoise on them.
  const next = { ...(view as AppData) };
  for (const name of names) (next[name] as StoredRecord[]) = liveRows(name);
  view = next;
}

async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage.persist();
  } catch {
    // Absent in some browsers. Best effort: the backup protects the data either way.
  }
}

async function readDisk(): Promise<void> {
  void requestPersistence();
  const [entries, bodyweights, customExercises, notes, storedDirty] = await transact(
    [...COLLECTIONS, 'meta'],
    'readonly',
    (tx) =>
      Promise.all([
        tx.objectStore('entries').getAll() as Promise<Entry[]>,
        tx.objectStore('bodyweights').getAll() as Promise<Bodyweight[]>,
        tx.objectStore('customExercises').getAll() as Promise<CustomExercise[]>,
        tx.objectStore('notes').getAll() as Promise<ExerciseNote[]>,
        tx.objectStore('meta').get(DIRTY_KEY) as Promise<boolean | undefined>,
      ]),
  );
  dirty = storedDirty === true;
  view = { entries: [], bodyweights: [], customExercises: [], notes: [] };
  absorb(COLLECTIONS, { entries, bodyweights, customExercises, notes });
  notify();
}

function load(): Promise<void> {
  loading ??= readDisk().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Writes run one at a time, so each one sees the result of the one before. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(load).then(job);
  queue = run.catch(() => {});
  return run;
}

async function save(changes: Changes, markDirty: boolean): Promise<void> {
  const names = COLLECTIONS.filter((name) => changes[name]?.length);
  const flagDirty = markDirty && !dirty;
  if (!names.length && !flagDirty) return;
  await transact([...names, 'meta'], 'readwrite', async (tx) => {
    // One at a time: requests still pending when one throws would reject unhandled.
    for (const name of names) {
      for (const record of changes[name] ?? []) await tx.objectStore(name).put(record);
    }
    if (flagDirty) await tx.objectStore('meta').put(true, DIRTY_KEY);
  });
  dirty ||= markDirty;
  if (names.length) {
    absorb(names, changes);
    notify();
  }
}

function localWrite<T>(build: () => { changes: Changes; result: T }): Promise<T> {
  return enqueue(async () => {
    const { changes, result } = build();
    if (!Object.keys(changes).length) return result;
    await save(changes, true);
    revision += 1;
    for (const listener of [...writeListeners]) listener();
    return result;
  });
}

export function addEntry(input: Pick<Entry, 'exerciseId' | 'date' | 'weightKg' | 'reps'>): Promise<Entry> {
  return localWrite(() => {
    const entry: Entry = {
      id: crypto.randomUUID(),
      exerciseId: input.exerciseId,
      date: input.date,
      weightKg: input.weightKg,
      reps: input.reps,
      updatedAt: stamp(),
    };
    return { changes: { entries: [entry] }, result: entry };
  });
}

export function updateEntry(
  id: string,
  patch: Partial<Pick<Entry, 'date' | 'weightKg' | 'reps'>>,
): Promise<void> {
  return localWrite(() => {
    const entry = memory.entries.get(id) as Entry | undefined;
    if (!entry || entry.deleted) throw new Error(`No entry with id ${id}`);
    const updated: Entry = { ...entry, ...patch, updatedAt: stamp() };
    return { changes: { entries: [updated] }, result: undefined };
  });
}

function tombstone(name: Collection, key: string): { changes: Changes; result: undefined } {
  const record = memory[name].get(key);
  if (!record || record.deleted) return { changes: {}, result: undefined };
  return {
    changes: { [name]: [{ ...record, deleted: true, updatedAt: stamp() }] },
    result: undefined,
  };
}

export function deleteEntry(id: string): Promise<void> {
  return localWrite(() => tombstone('entries', id));
}

export function setBodyweight(date: ISODate, kg: number): Promise<void> {
  return localWrite(() => ({
    changes: { bodyweights: [{ date, kg, updatedAt: stamp() }] },
    result: undefined,
  }));
}

export function deleteBodyweight(date: ISODate): Promise<void> {
  return localWrite(() => tombstone('bodyweights', date));
}

/** Creates or replaces a custom exercise. An empty `def.id` gets a new id. */
export function saveCustomExercise(def: ExerciseDef): Promise<CustomExercise> {
  return localWrite(() => {
    const exercise: CustomExercise = {
      id: def.id || crypto.randomUUID(),
      name: def.name,
      group: def.group,
      primaryMuscles: def.primaryMuscles,
      secondaryMuscles: def.secondaryMuscles,
      equipment: def.equipment,
      updatedAt: stamp(),
    };
    return { changes: { customExercises: [exercise] }, result: exercise };
  });
}

export function setNote(exerciseId: string, note: string): Promise<void> {
  return localWrite(() => ({
    changes: { notes: [{ exerciseId, note, updatedAt: stamp() }] },
    result: undefined,
  }));
}

/** Current data without tombstones; null until loaded. Stable between changes. */
export function getAppData(): AppData | null {
  return view;
}

/** Calling this starts the load, so `useAppData` needs no separate setup. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  load().catch((error: unknown) => console.error('fitNotes: could not load data', error));
  return () => {
    listeners.delete(listener);
  };
}

export function useAppData(): AppData | null {
  return useSyncExternalStore(subscribe, getAppData, () => null);
}

/** True until loaded, and while there is no live record. Tombstones do not count. */
export function isEmpty(): boolean {
  const data = view;
  return !data || COLLECTIONS.every((name) => data[name].length === 0);
}

// Lower-level API for src/backup.

/** Every record, tombstones included. */
export async function readAll(): Promise<AppData> {
  await load();
  return {
    entries: [...memory.entries.values()] as Entry[],
    bodyweights: [...memory.bodyweights.values()] as Bodyweight[],
    customExercises: [...memory.customExercises.values()] as CustomExercise[],
    notes: [...memory.notes.values()] as ExerciseNote[],
  };
}

/**
 * Applies records in one transaction, keeping whichever version of each wins
 * `compareRecords`, so a local write made since the merge started is never
 * overwritten by older merged data. Never clears the dirty flag: pass
 * `dirty: true` when the merge produced something the remote lacks.
 */
export function applySnapshot(records: AppData, options: { dirty: boolean }): Promise<void> {
  return enqueue(() => {
    const changes: Changes = {};
    for (const name of COLLECTIONS) {
      const incoming: StoredRecord[] = records[name];
      const winners = incoming.filter((record) => {
        const held = memory[name].get(keyOf(name, record));
        return !held || compareRecords(record, held) > 0;
      });
      if (winners.length) changes[name] = winners;
    }
    return save(changes, options.dirty);
  });
}

export function isDirty(): boolean {
  return dirty;
}

/** Counts local writes. Read it before reading the data a sync will back up. */
export function localRevision(): number {
  return revision;
}

/** Clears the dirty flag unless a local write has landed since `seenRevision`. */
export function markClean(seenRevision: number): Promise<void> {
  return enqueue(async () => {
    if (seenRevision !== revision || !dirty) return;
    await transact(['meta'], 'readwrite', (tx) => tx.objectStore('meta').put(false, DIRTY_KEY));
    dirty = false;
  });
}

/** Calls `listener` after each committed local write, but not after `applySnapshot`. */
export function onLocalWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => {
    writeListeners.delete(listener);
  };
}

export function getMeta<T>(key: string): Promise<T | undefined> {
  return transact(['meta'], 'readonly', (tx) => tx.objectStore('meta').get(key) as Promise<T | undefined>);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await transact(['meta'], 'readwrite', (tx) => tx.objectStore('meta').put(value, key));
}
