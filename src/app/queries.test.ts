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

  it('AC29: shares logged dumbbells across exercises, but not machine weights', () => {
    const press = 'Incline_Dumbbell_Press';
    const curl = 'Dumbbell_Bicep_Curl';
    const own = [entry(press, '2026-03-01', 40, 4), entry(press, '2026-03-04', 37.5, 8)];
    for (const kg of Object.values(buildQueries(data(own)).predict(press, '2026-03-05')!)) {
      expect([39.5, 33.5]).not.toContain(kg);
      expect(kg % 2.5 === 0 || [40, 37.5].includes(kg)).toBe(true);
    }

    // A curl of 12.5 x 7 per hand puts yellow just under 12 kg.
    const curlOnly = [entry(curl, '2026-03-01', 12.5, 7)];
    expect(buildQueries(data(curlOnly)).predict(curl, '2026-03-02')?.yellow).toBe(12.5);
    const withPress = buildQueries(data([...curlOnly, entry(press, '2026-03-01', 12, 8)]));
    expect(withPress.predict(curl, '2026-03-02')?.yellow).toBe(12);

    const machine = 'Leg_Extensions';
    const alone = buildQueries(data([entry(machine, '2026-03-01', 50, 8)]));
    const withOther = buildQueries(data([entry(machine, '2026-03-01', 50, 8), entry('Lying_Leg_Curls', '2026-03-01', 51, 8)]));
    expect(withOther.predict(machine, '2026-03-02')).toEqual(alone.predict(machine, '2026-03-02'));
  });

  it('AC32: suggests less added weight for 5 reps on Pushups than on Pullups, both first logged at 0 x 20', () => {
    const queries = buildQueries(data([entry('Pushups', '2026-03-01', 0, 20), entry('Pullups', '2026-03-01', 0, 20)]));
    const pushUps = queries.predict('Pushups', '2026-03-02')?.red as number;
    const pullUps = queries.predict('Pullups', '2026-03-02')?.red as number;
    expect(pushUps).toBeLessThan(pullUps);
  });

  it('reports no bodyweight until one is recorded', () => {
    expect(buildQueries(data([], { bodyweights: [] })).bodyweightKg('2026-03-01')).toBeNull();
    expect(buildQueries(data([])).bodyweightKg('2026-03-01')).toBe(80);
  });
});

describe('AC36: next workout', () => {
  const ROWS = 'Seated_Cable_Rows';
  const CURL = 'Dumbbell_Bicep_Curl';
  const PUSHDOWN = 'Triceps_Pushdown_-_Rope_Attachment';
  const REAR_DELT = 'Cable_Rear_Delt_Fly';
  const next = (entries: Entry[]) => buildQueries(data(entries)).nextWorkout('2026-03-10');

  it('picks the workout whose muscles have rested longest', () => {
    const rotation = [
      entry(BENCH, '2026-03-01', 80, 8),
      entry(ROWS, '2026-03-02', 60, 8),
      entry(SQUAT, '2026-03-03', 100, 8),
    ];
    expect(next(rotation)).toBe('Push');
    expect(next([...rotation, entry(BENCH, '2026-03-04', 80, 8)])).toBe('Pull');
  });

  it("doesn't let one pull muscle on push day make pull look fresh", () => {
    expect(
      next([
        entry(ROWS, '2026-03-01', 60, 8),
        entry(CURL, '2026-03-01', 12, 8),
        entry(BENCH, '2026-03-03', 80, 8),
        entry(PUSHDOWN, '2026-03-03', 30, 8),
        entry(REAR_DELT, '2026-03-03', 7.5, 11),
        entry(SQUAT, '2026-03-06', 100, 8),
      ]),
    ).toBe('Pull');
  });

  it('puts a never-trained workout first and breaks ties in the order push, pull, legs', () => {
    expect(next([entry(BENCH, '2026-03-09', 80, 8), entry(SQUAT, '2026-03-09', 100, 8)])).toBe('Pull');
    expect(next([entry(SQUAT, '2026-03-09', 100, 8)])).toBe('Push');
    expect(next([entry(BENCH, '2026-03-05', 80, 8), entry(ROWS, '2026-03-05', 60, 8), entry(SQUAT, '2026-03-05', 100, 8)])).toBe('Push');
  });

  it('counts primary muscles only, ignores core, and is null before any workout muscle', () => {
    // Squats list lower back as secondary; it must not make pull look trained.
    expect(next([entry(BENCH, '2026-03-01', 80, 8), entry(ROWS, '2026-03-02', 60, 8), entry(SQUAT, '2026-03-09', 100, 8)])).toBe('Push');
    expect(next([entry('Barbell_Deadlift', '2026-03-09', 140, 5), entry(BENCH, '2026-03-09', 80, 8)])).toBe('Legs');
    expect(next([entry('Hanging_Leg_Raise', '2026-03-09', 0, 12)])).toBeNull();
    expect(next([])).toBeNull();
  });
});
