import type { Group, Muscle } from '../domain/types';

/** Primary reads clearly brighter than secondary (AC3). */
export const PRIMARY_FILL = '#ffffff';
export const SECONDARY_FILL = '#636366';

export interface MuscleSelection {
  /** In tapping order: the first one sets a custom exercise's group. */
  primary: Muscle[];
  secondary: Muscle[];
}

const GROUP_OF_MUSCLE: Record<Muscle, Group> = {
  chest: 'Chest',
  'upper-back': 'Back',
  'lower-back': 'Back',
  trapezius: 'Back',
  'front-deltoids': 'Shoulders',
  'back-deltoids': 'Shoulders',
  neck: 'Shoulders',
  biceps: 'Arms',
  triceps: 'Arms',
  forearm: 'Arms',
  quadriceps: 'Legs',
  hamstring: 'Legs',
  gluteal: 'Legs',
  calves: 'Legs',
  adductor: 'Legs',
  abductors: 'Legs',
  abs: 'Core',
  obliques: 'Core',
};

export function groupOfMuscle(muscle: Muscle): Group {
  return GROUP_OF_MUSCLE[muscle];
}

/** BodyMap fills. A muscle listed as both reads as primary. */
export function muscleFills(primary: Muscle[], secondary: Muscle[]): Partial<Record<Muscle, string>> {
  const fills: Partial<Record<Muscle, string>> = {};
  for (const muscle of secondary) fills[muscle] = SECONDARY_FILL;
  for (const muscle of primary) fills[muscle] = PRIMARY_FILL;
  return fills;
}

/** One tap: none → primary → secondary → none. */
export function cycleMuscle({ primary, secondary }: MuscleSelection, muscle: Muscle): MuscleSelection {
  if (primary.includes(muscle)) {
    return { primary: primary.filter((other) => other !== muscle), secondary: [...secondary, muscle] };
  }
  if (secondary.includes(muscle)) {
    return { primary, secondary: secondary.filter((other) => other !== muscle) };
  }
  return { primary: [...primary, muscle], secondary };
}
