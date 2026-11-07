import { useMemo } from 'react';
import { type MuscleDetail, muscleBalance, muscleDetail } from '../balance';
import { EXERCISES } from '../data';
import { daysBetween } from '../domain/date';
import type {
  Bodyweight,
  Entry,
  Equipment,
  Exercise,
  Group,
  ISODate,
  Muscle,
  Prediction,
} from '../domain/types';
import {
  type ModelInput,
  type StrengthHistory,
  bodyweightOn,
  lastColour,
  oneRepMax,
  predict,
  strengthHistory,
} from '../model';
import { type AppData, useAppData } from '../store';

const GROUPS: readonly Group[] = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core'];

export type Workout = 'Push' | 'Pull' | 'Legs';

/** The primary muscles each workout trains. Core and neck belong to none. */
const WORKOUTS: Record<Workout, readonly Muscle[]> = {
  Push: ['chest', 'front-deltoids', 'triceps'],
  Pull: ['upper-back', 'lower-back', 'trapezius', 'back-deltoids', 'biceps', 'forearm'],
  Legs: ['quadriceps', 'hamstring', 'gluteal', 'adductor', 'abductors', 'calves'],
};

/** Free weights share one rack across exercises; machines, cables and the rest do not. */
const RACKS: readonly Equipment[] = ['dumbbell', 'barbell', 'kettlebell'];

export interface LoggedExercise {
  exercise: Exercise;
  lastDate: ISODate;
  /** The weight for the exercise's colour next time. */
  next: number | null;
}

export interface LoggedGroup {
  group: Group;
  exercises: LoggedExercise[];
}

export interface Queries {
  exercises: Exercise[];
  exercise(id: string): Exercise | undefined;
  /** Live entries for one exercise, newest first. */
  entries(exerciseId: string): Entry[];
  /** Only logged exercises, by group, most recent first within each. */
  logged(date: ISODate): LoggedGroup[];
  predict(exerciseId: string, date: ISODate): Prediction | null;
  strengthHistory(exerciseId: string, asOf: ISODate): StrengthHistory;
  muscleBalance(date: ISODate): Record<Muscle, number | null>;
  muscleDetail(muscle: Muscle, date: ISODate): MuscleDetail | null;
  /**
   * The workout whose muscles have rested longest: the median of days since each muscle it
   * trains was last a primary muscle, so one odd muscle can't swing it. A workout never
   * trained comes first; ties go Push, Pull, Legs. Null until a workout muscle is trained.
   */
  nextWorkout(date: ISODate): Workout | null;
  /** The bodyweight in force on a date, or null when none has ever been recorded. */
  bodyweightKg(date: ISODate): number | null;
}

function newestFirst(a: Entry, b: Entry): number {
  return b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function latestBodyweight(bodyweights: Bodyweight[], date: ISODate): number | null {
  return bodyweights.length > 0 ? bodyweightOn(bodyweights, date) : null;
}

export function buildQueries(data: AppData): Queries {
  const entriesById = new Map<string, Entry[]>();
  for (const entry of data.entries) {
    const list = entriesById.get(entry.exerciseId);
    if (list) list.push(entry);
    else entriesById.set(entry.exerciseId, [entry]);
  }
  for (const list of entriesById.values()) list.sort(newestFirst);

  const notes = new Map(data.notes.map((note) => [note.exerciseId, note.note]));
  const exercises = EXERCISES.map(
    (def): Exercise => ({
      ...def,
      colour: lastColour(entriesById.get(def.id) ?? []),
      note: notes.get(def.id) ?? '',
    }),
  );
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  const rack = new Map<Equipment, { exerciseId: string; weightKg: number }[]>();
  for (const { exerciseId, weightKg, deleted } of data.entries) {
    const equipment = byId.get(exerciseId)?.equipment;
    if (deleted || !equipment || !RACKS.includes(equipment)) continue;
    rack.set(equipment, [...(rack.get(equipment) ?? []), { exerciseId, weightKg }]);
  }

  const inputFor = (exerciseId: string): ModelInput => {
    const exercise = byId.get(exerciseId);
    const equipment = exercise?.equipment ?? 'other';
    return {
      equipment,
      perHand: exercise?.perHand ?? false,
      bodyweightShare: exercise?.bodyweightShare ?? 1,
      entries: entriesById.get(exerciseId) ?? [],
      bodyweights: data.bodyweights,
      rackWeights: (rack.get(equipment) ?? []).flatMap((logged) => (logged.exerciseId === exerciseId ? [] : [logged.weightKg])),
    };
  };

  const liftsOn = (date: ISODate) =>
    [...entriesById.keys()].flatMap((exerciseId) => {
      const oneRepMaxKg = oneRepMax(inputFor(exerciseId), date);
      return oneRepMaxKg === null ? [] : [{ exerciseId, oneRepMaxKg }];
    });
  const bodyweightForMap = (date: ISODate) => bodyweightOn(data.bodyweights, date);

  return {
    exercises,
    exercise: (id) => byId.get(id),
    entries: (exerciseId) => entriesById.get(exerciseId) ?? [],
    logged(date) {
      const rows: LoggedExercise[] = [];
      for (const [exerciseId, entries] of entriesById) {
        const exercise = byId.get(exerciseId);
        if (!exercise) continue;
        const prediction = predict(inputFor(exerciseId), date);
        rows.push({ exercise, lastDate: entries[0].date, next: prediction?.[exercise.colour] ?? null });
      }
      rows.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
      return GROUPS.flatMap((group) => {
        const inGroup = rows.filter((row) => row.exercise.group === group);
        return inGroup.length > 0 ? [{ group, exercises: inGroup }] : [];
      });
    },
    predict: (exerciseId, date) => predict(inputFor(exerciseId), date),
    strengthHistory: (exerciseId, asOf) => strengthHistory(inputFor(exerciseId), asOf),
    muscleBalance: (date) => muscleBalance(liftsOn(date), bodyweightForMap(date)),
    muscleDetail: (muscle, date) => muscleDetail(muscle, liftsOn(date), bodyweightForMap(date)),
    nextWorkout(date) {
      const lastTrained = new Map<Muscle, ISODate>();
      for (const [exerciseId, entries] of entriesById) {
        for (const muscle of byId.get(exerciseId)?.primaryMuscles ?? []) {
          const last = lastTrained.get(muscle);
          if (!last || entries[0].date > last) lastTrained.set(muscle, entries[0].date);
        }
      }
      const rests = (Object.keys(WORKOUTS) as Workout[]).map((workout) => {
        const days = WORKOUTS[workout].flatMap((muscle) => {
          const last = lastTrained.get(muscle);
          return last ? [daysBetween(last, date)] : [];
        });
        return { workout, rest: days.length > 0 ? median(days) : Infinity };
      });
      if (rests.every(({ rest }) => rest === Infinity)) return null;
      return rests.reduce((best, next) => (next.rest > best.rest ? next : best)).workout;
    },
    bodyweightKg: (date) => latestBodyweight(data.bodyweights, date),
  };
}

/** Everything the screens read. Null until the store has loaded. */
export function useQueries(): Queries | null {
  const data = useAppData();
  return useMemo(() => data && buildQueries(data), [data]);
}
