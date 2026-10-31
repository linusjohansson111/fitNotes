import type { Muscle } from '../domain/types';

/** Every muscle the app uses, with the name shown for it. */
export const MUSCLE_NAMES: Record<Muscle, string> = {
  trapezius: 'Traps',
  'upper-back': 'Upper back',
  'lower-back': 'Lower back',
  chest: 'Chest',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearm: 'Forearms',
  'back-deltoids': 'Rear delts',
  'front-deltoids': 'Front delts',
  abs: 'Abs',
  obliques: 'Obliques',
  adductor: 'Adductors',
  hamstring: 'Hamstrings',
  quadriceps: 'Quads',
  abductors: 'Abductors',
  calves: 'Calves',
  gluteal: 'Glutes',
  neck: 'Neck',
};

export function isMuscle(value: string): value is Muscle {
  return Object.hasOwn(MUSCLE_NAMES, value);
}
