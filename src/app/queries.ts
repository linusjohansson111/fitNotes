import { useMemo } from 'react';
import { type MuscleDetail, isCounted, muscleBalance, muscleDetail } from '../balance';
import { EXERCISES } from '../data';
import type {
  Bodyweight,
  Entry,
  Exercise,
  ExerciseDef,
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
  /** Custom exercises first, then the bank. */
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
  /** The bodyweight in force on a date, or null when none has ever been recorded. */
  bodyweightKg(date: ISODate): number | null;
}

function newestFirst(a: Entry, b: Entry): number {
  return b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt;
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
  const toExercise = ({ id, name, group, primaryMuscles, secondaryMuscles, equipment }: ExerciseDef, custom: boolean): Exercise => ({
    id,
    name,
    group,
    primaryMuscles,
    secondaryMuscles,
    equipment,
    colour: lastColour(entriesById.get(id) ?? []),
    note: notes.get(id) ?? '',
    custom,
  });

  const exercises = [
    ...data.customExercises.map((def) => toExercise(def, true)),
    ...EXERCISES.map((def) => toExercise(def, false)),
  ];
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  const inputFor = (exerciseId: string): ModelInput => ({
    equipment: byId.get(exerciseId)?.equipment ?? 'other',
    entries: entriesById.get(exerciseId) ?? [],
    bodyweights: data.bodyweights,
  });

  const liftsOn = (date: ISODate) =>
    [...entriesById.keys()].filter(isCounted).flatMap((exerciseId) => {
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
    bodyweightKg: (date) => latestBodyweight(data.bodyweights, date),
  };
}

/** Everything the screens read. Null until the store has loaded. */
export function useQueries(): Queries | null {
  const data = useAppData();
  return useMemo(() => data && buildQueries(data), [data]);
}
