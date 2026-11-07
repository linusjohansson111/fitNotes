import { type Queries, buildQueries } from '../app/queries';
import { addDays, today } from '../domain/date';
import type { Entry } from '../domain/types';
import type { AppData } from '../store';

export const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';
export const SQUAT = 'Barbell_Squat';
export const PULLUP = 'Pullups';
export const CURL = 'Dumbbell_Bicep_Curl';
export const INCLINE = 'Incline_Dumbbell_Press';
export const KETTLEBELL = 'Alternating_Kettlebell_Press';

let nextId = 1;

/** An entry `daysAgo` days before today. */
export function entry(exerciseId: string, daysAgo: number, weightKg: number, reps: number): Entry {
  return {
    id: `entry-${nextId}`,
    exerciseId,
    date: addDays(today(), -daysAgo),
    weightKg,
    reps,
    updatedAt: nextId++,
  };
}

export function queriesFor(entries: Entry[], extra: Partial<AppData> = {}): Queries {
  return buildQueries({
    entries,
    bodyweights: [{ date: '2026-01-01', kg: 80, updatedAt: 1 }],
    customExercises: [],
    notes: [],
    ...extra,
  });
}
