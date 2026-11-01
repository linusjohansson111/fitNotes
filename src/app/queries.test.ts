import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../data';
import type { Entry } from '../domain/types';
import type { AppData } from '../store';
import { buildQueries } from './queries';

const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';
const SQUAT = 'Barbell_Squat';

let nextId = 1;
function entry(exerciseId: string, date: string, weightKg: number, reps: number): Entry {
  return { id: `e${nextId}`, exerciseId, date, weightKg, reps, updatedAt: nextId++ };
}

const data = (entries: Entry[], extra: Partial<AppData> = {}): AppData => ({
  entries,
  bodyweights: [{ date: '2026-01-01', kg: 80, updatedAt: 1 }],
  customExercises: [],
  notes: [],
  ...extra,
});

describe('buildQueries', () => {
  it('AC4: lists only logged exercises by group, most recent first', () => {
    const queries = buildQueries(
      data([
        entry(SQUAT, '2026-03-01', 100, 8),
        entry(BENCH, '2026-03-02', 80, 8),
        entry('Incline_Dumbbell_Press', '2026-03-03', 30, 8),
      ]),
    );
    const groups = queries.logged('2026-03-05');
    expect(groups.map((group) => group.group)).toEqual(['Chest', 'Legs']);
    expect(groups[0].exercises.map((row) => row.exercise.id)).toEqual(['Incline_Dumbbell_Press', BENCH]);
    expect(groups[0].exercises[1].next).toBe(80);
  });

  it("gives an exercise its last entry's colour, and yellow before any entry", () => {
    const queries = buildQueries(data([entry(BENCH, '2026-03-01', 80, 8), entry(BENCH, '2026-03-02', 90, 4)]));
    expect(queries.exercise(BENCH)?.colour).toBe('red');
    expect(queries.exercise(SQUAT)?.colour).toBe('yellow');
  });

  it('AC14: deleting an entry recalculates predictions and the muscle map', () => {
    const kept = entry(BENCH, '2026-03-01', 80, 8);
    const removed = entry(BENCH, '2026-03-02', 100, 8);
    const after = buildQueries(data([kept]));
    const before = buildQueries(data([kept, removed]));
    expect(before.predict(BENCH, '2026-03-03')).not.toEqual(after.predict(BENCH, '2026-03-03'));
    expect(after.predict(BENCH, '2026-03-03')).toEqual(buildQueries(data([kept])).predict(BENCH, '2026-03-03'));
  });

  it('AC16: every exercise in the bank is predicted and counts on the map for each of its muscles', () => {
    for (const { id, primaryMuscles, secondaryMuscles } of EXERCISES) {
      const queries = buildQueries(data([entry(id, '2026-03-01', 40, 8)]));
      expect(queries.predict(id, '2026-03-02')?.yellow, id).toBeTypeOf('number');
      const balance = queries.muscleBalance('2026-03-02');
      for (const muscle of [...primaryMuscles, ...secondaryMuscles]) expect(balance[muscle], id).toBe(0);
    }
  });

  it('leaves an entry on a removed exercise out of the map, as Home leaves it out', () => {
    const bench = entry(BENCH, '2026-03-01', 80, 8);
    const without = buildQueries(data([bench]));
    const withOld = buildQueries(data([bench, entry('custom_1', '2026-03-01', 500, 8)]));
    expect(withOld.muscleBalance('2026-03-02')).toEqual(without.muscleBalance('2026-03-02'));
    expect(withOld.logged('2026-03-02')).toEqual(without.logged('2026-03-02'));
  });

  it('reports no bodyweight until one is recorded', () => {
    expect(buildQueries(data([], { bodyweights: [] })).bodyweightKg('2026-03-01')).toBeNull();
    expect(buildQueries(data([])).bodyweightKg('2026-03-01')).toBe(80);
  });
});
