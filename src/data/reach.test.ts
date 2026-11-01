import { describe, expect, it } from 'vitest';
import { buildQueries } from '../app/queries';
import { EXERCISES, searchExercises } from './index';

describe('every row is reachable', () => {
  it('is found by its own name, within what search lists', () => {
    const missing = EXERCISES.filter(
      (exercise) => !searchExercises(exercise.name, EXERCISES, 40).some(({ id }) => id === exercise.id),
    ).map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it('ranks first for its own name', () => {
    const beaten = EXERCISES.flatMap((exercise) => {
      const first = searchExercises(exercise.name, EXERCISES, 1)[0];
      return first?.id === exercise.id ? [] : [`${exercise.name} -> ${first?.name}`];
    });
    expect(beaten).toEqual([]);
  });

  it('shows on Home, predicts and has a graph once logged', () => {
    const data = { bodyweights: [{ date: '2026-01-01', kg: 80, updatedAt: 1 }], customExercises: [], notes: [] };
    for (const { id, group } of EXERCISES) {
      const entries = [{ id: 'e', exerciseId: id, date: '2026-03-01', weightKg: 40, reps: 8, updatedAt: 2 }];
      const queries = buildQueries({ ...data, entries });
      const [home] = queries.logged('2026-03-02');
      expect(home?.group, id).toBe(group);
      expect(home?.exercises[0].exercise.id, id).toBe(id);
      expect(home?.exercises[0].next, id).toBeTypeOf('number');
      expect(queries.strengthHistory(id, '2026-03-02').dots, id).toHaveLength(1);
    }
  });
});
