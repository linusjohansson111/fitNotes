/**
 * Shared contract for every fitNotes module. Names follow SPEC.md.
 * Change this file only through the integration branch: all modules depend on it.
 */

/** Local calendar date, 'YYYY-MM-DD'. Compare as strings; never parse as UTC. */
export type ISODate = string;

export type Colour = 'red' | 'yellow' | 'green';

export type Group = 'Chest' | 'Back' | 'Shoulders' | 'Arms' | 'Legs' | 'Core';

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'kettlebell'
  | 'bodyweight'
  | 'other';

/** Exactly the react-body-highlighter muscle slugs the app uses. */
export type Muscle =
  | 'trapezius'
  | 'upper-back'
  | 'lower-back'
  | 'chest'
  | 'biceps'
  | 'triceps'
  | 'forearm'
  | 'back-deltoids'
  | 'front-deltoids'
  | 'abs'
  | 'obliques'
  | 'adductor'
  | 'hamstring'
  | 'quadriceps'
  | 'abductors'
  | 'calves'
  | 'gluteal'
  | 'neck';

/** Fields every synced record carries. `deleted` is a tombstone kept for merging backups. */
export interface SyncMeta {
  /** ms since epoch, stamped on every local write. Higher wins when merging. */
  updatedAt: number;
  deleted?: boolean;
}

/**
 * One strongest set. Dumbbells are per hand. Bodyweight exercises log added
 * weight, negative for assistance.
 */
export interface Entry extends SyncMeta {
  id: string;
  exerciseId: string;
  date: ISODate;
  weightKg: number;
  reps: number;
}

/** One record per date. */
export interface Bodyweight extends SyncMeta {
  date: ISODate;
  kg: number;
}

/** The static definition: a bank row or a user's custom exercise. */
export interface ExerciseDef {
  id: string;
  name: string;
  group: Group;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  equipment: Equipment;
}

/** A definition merged with user state. `colour` is derived from the last entry. */
export interface Exercise extends ExerciseDef {
  colour: Colour;
  note: string;
  custom: boolean;
}

export interface CustomExercise extends ExerciseDef, SyncMeta {}

export interface ExerciseNote extends SyncMeta {
  exerciseId: string;
  note: string;
}

/** Weight for each colour's target reps. */
export type Prediction = Record<Colour, number>;
