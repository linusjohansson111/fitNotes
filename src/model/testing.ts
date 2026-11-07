import { addDays } from '../domain/date';
import type { Bodyweight, Entry, Equipment, ISODate } from '../domain/types';
import type { ModelInput } from './fit';

/** Test support: terse builders for logs. Not part of the model. */

export const DAY_0: ISODate = '2026-01-01';

let nextId = 0;

export function set(day: number, weightKg: number, reps: number, extra: Partial<Entry> = {}): Entry {
  nextId += 1;
  return {
    id: `entry-${nextId}`,
    exerciseId: 'test-exercise',
    date: addDays(DAY_0, day),
    weightKg,
    reps,
    updatedAt: day,
    ...extra,
  };
}

export const log = (
  equipment: Equipment,
  entries: Entry[],
  bodyweights: Bodyweight[] = [],
  extra: Partial<ModelInput> = {},
): ModelInput => ({
  equipment,
  entries,
  bodyweights,
  perHand: false,
  bodyweightShare: 1,
  rackWeights: [],
  ...extra,
});

export const barbell = (...entries: Entry[]): ModelInput => log('barbell', entries);

export const weighIn = (day: number, kg: number): Bodyweight => ({
  date: addDays(DAY_0, day),
  kg,
  updatedAt: 0,
});

export const on = (day: number): ISODate => addDays(DAY_0, day);
