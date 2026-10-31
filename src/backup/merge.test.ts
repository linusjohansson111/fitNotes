import { describe, expect, it } from 'vitest';
import type { Bodyweight, CustomExercise, Entry, ExerciseNote } from '../domain/types';
import { emptySnapshot, merge, sameRecords, type Snapshot } from './merge';

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'a',
  exerciseId: 'bench',
  date: '2026-10-01',
  weightKg: 80,
  reps: 8,
  updatedAt: 100,
  ...over,
});

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({ ...emptySnapshot(), ...over });

/** Seeded so a failing property reproduces. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Few keys and few timestamps, so collisions and exact ties are common. */
function randomSnapshot(next: () => number): Snapshot {
  const pick = (max: number) => Math.floor(next() * max);
  const meta = () => ({ updatedAt: 1 + pick(4), ...(pick(3) === 0 ? { deleted: true } : {}) });
  const rows = <T>(make: () => T): T[] => Array.from({ length: pick(6) }, make);
  const key = () => 'abcd'[pick(4)];
  const date = () => `2026-10-0${1 + pick(4)}`;

  return {
    version: 1,
    exportedAt: pick(1000),
    entries: rows<Entry>(() => ({
      id: key(),
      exerciseId: 'bench',
      date: date(),
      weightKg: 40 + pick(3),
      reps: 1 + pick(3),
      ...meta(),
    })),
    bodyweights: rows<Bodyweight>(() => ({ date: date(), kg: 70 + pick(3), ...meta() })),
    customExercises: rows<CustomExercise>(() => ({
      id: key(),
      name: `Name ${pick(3)}`,
      group: 'Arms',
      primaryMuscles: ['biceps'],
      secondaryMuscles: [],
      equipment: 'cable',
      ...meta(),
    })),
    notes: rows<ExerciseNote>(() => ({ exerciseId: key(), note: `Note ${pick(3)}`, ...meta() })),
  };
}

function forEachSeed(check: (next: () => number) => void): void {
  for (let seed = 1; seed <= 500; seed++) check(random(seed));
}

describe('merge properties', () => {
  it('is commutative', () => {
    forEachSeed((next) => {
      const [a, b] = [randomSnapshot(next), randomSnapshot(next)];
      expect(merge(a, b)).toEqual(merge(b, a));
    });
  });

  it('is associative', () => {
    forEachSeed((next) => {
      const [a, b, c] = [randomSnapshot(next), randomSnapshot(next), randomSnapshot(next)];
      expect(merge(merge(a, b), c)).toEqual(merge(a, merge(b, c)));
    });
  });

  it('is idempotent', () => {
    forEachSeed((next) => {
      const [a, b] = [randomSnapshot(next), randomSnapshot(next)];
      const merged = merge(a, b);
      expect(merge(merged, merged)).toEqual(merged);
      expect(merge(merged, a)).toEqual(merged);
      expect(merge(merged, b)).toEqual(merged);
    });
  });

  it('keeps every key, at the highest updatedAt of either side', () => {
    forEachSeed((next) => {
      const [a, b] = [randomSnapshot(next), randomSnapshot(next)];
      const merged = merge(a, b);
      const newest = new Map<string, number>();
      for (const { id, updatedAt } of [...a.entries, ...b.entries]) {
        newest.set(id, Math.max(newest.get(id) ?? 0, updatedAt));
      }
      expect(new Map(merged.entries.map((row) => [row.id, row.updatedAt]))).toEqual(newest);
      expect(merged.entries).toHaveLength(newest.size);
    });
  });

  it('does not mutate its inputs', () => {
    forEachSeed((next) => {
      const [a, b] = [randomSnapshot(next), randomSnapshot(next)];
      const before = JSON.stringify([a, b]);
      merge(a, b);
      expect(JSON.stringify([a, b])).toBe(before);
    });
  });
});

describe('merge', () => {
  it('unions each collection by its record key', () => {
    const bodyweight = (date: string, kg: number, updatedAt: number): Bodyweight => ({ date, kg, updatedAt });
    const note = (exerciseId: string, text: string, updatedAt: number): ExerciseNote => ({
      exerciseId,
      note: text,
      updatedAt,
    });

    const merged = merge(
      snapshot({
        entries: [entry({ id: 'a', reps: 5, updatedAt: 2 }), entry({ id: 'b' })],
        bodyweights: [bodyweight('2026-10-01', 80, 2), bodyweight('2026-10-02', 81, 1)],
        notes: [note('bench', 'new', 2)],
      }),
      snapshot({
        entries: [entry({ id: 'a', reps: 8, updatedAt: 1 }), entry({ id: 'c' })],
        bodyweights: [bodyweight('2026-10-01', 79, 1)],
        notes: [note('bench', 'old', 1), note('squat', 'deep', 1)],
      }),
    );

    expect(merged.entries.map((row) => [row.id, row.reps])).toEqual([
      ['a', 5],
      ['b', 8],
      ['c', 8],
    ]);
    expect(merged.bodyweights.map((row) => row.kg)).toEqual([80, 81]);
    expect(merged.notes.map((row) => row.note)).toEqual(['new', 'deep']);
  });

  it('lets a tombstone beat an older live copy and keeps it in the result', () => {
    const tombstone = entry({ deleted: true, updatedAt: 200 });
    const merged = merge(snapshot({ entries: [entry()] }), snapshot({ entries: [tombstone] }));
    expect(merged.entries).toEqual([tombstone]);
  });

  it('lets a newer record beat an older tombstone', () => {
    const revived = entry({ updatedAt: 300 });
    const merged = merge(
      snapshot({ entries: [entry({ deleted: true, updatedAt: 200 })] }),
      snapshot({ entries: [revived] }),
    );
    expect(merged.entries).toEqual([revived]);
  });

  it('takes the later exportedAt', () => {
    expect(merge(snapshot({ exportedAt: 5 }), snapshot({ exportedAt: 9 })).exportedAt).toBe(9);
  });
});

describe('sameRecords', () => {
  it('ignores exportedAt, row order and field order', () => {
    const fieldsReversed = Object.fromEntries(Object.entries(entry({ id: 'b' })).reverse()) as unknown as Entry;
    expect(
      sameRecords(
        snapshot({ exportedAt: 1, entries: [entry({ id: 'a' }), entry({ id: 'b' })] }),
        snapshot({ exportedAt: 2, entries: [fieldsReversed, entry({ id: 'a' })] }),
      ),
    ).toBe(true);
  });

  it('notices an added record, a changed value and a new tombstone', () => {
    const base = snapshot({ entries: [entry()] });
    expect(sameRecords(base, snapshot({ entries: [entry(), entry({ id: 'b' })] }))).toBe(false);
    expect(sameRecords(base, snapshot({ entries: [entry({ reps: 9 })] }))).toBe(false);
    expect(sameRecords(base, snapshot({ entries: [entry({ deleted: true })] }))).toBe(false);
  });
});
