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

/** Every muscle the app tracks. The slugs come from react-body-highlighter and are stored in backups. */
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
 * One strongest set. Per-hand exercises log one hand's weight. Bodyweight exercises
 * log added weight, negative for assistance.
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

/** The measured lifts every other exercise is compared with. */
export type BaseLift =
  | 'Back Squat'
  | 'Bench Press'
  | 'Deadlift'
  | 'Front Squat'
  | 'Sumo Deadlift'
  | 'Incline Bench Press'
  | 'Overhead Press'
  | 'Dip'
  | 'Chin-Up'
  | 'Pull-Up'
  | 'Pendlay Row';

export type Confidence = 'high' | 'medium' | 'low';

export type Mechanic = 'compound' | 'isolation';

/** One row of src/data/exercises.json. */
export interface ExerciseDef {
  id: string;
  name: string;
  group: Group;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  equipment: Equipment;
  /** From the source, or tagged by hand where it has none. Compounds count more on the map. */
  mechanic: Mechanic;
  /** Two dumbbells or two cable handles: logged per hand, so the load is twice the weight. */
  perHand: boolean;
  /** Bodyweight rows only: the share of bodyweight a rep moves, in (0, 1]. */
  bodyweightShare?: number;
  baseLift: BaseLift;
  /** This exercise's 1RM over the base lift's, in logged terms. */
  ratio: number;
  confidence: Confidence;
  reason: string;
}

/** A definition merged with user state. `colour` is derived from the last entry. */
export interface Exercise extends ExerciseDef {
  colour: Colour;
  note: string;
}

/** Only kept so that existing backups still read: nothing creates these any more. */
export interface CustomExercise
  extends SyncMeta,
    Pick<ExerciseDef, 'id' | 'name' | 'group' | 'primaryMuscles' | 'secondaryMuscles' | 'equipment'> {}

export interface ExerciseNote extends SyncMeta {
  exerciseId: string;
  note: string;
}

/** Weight for each colour's target reps. */
export type Prediction = Record<Colour, number>;
