import type { Colour } from './types';

export const COLOURS: readonly Colour[] = ['red', 'yellow', 'green'];

/** Every set aims at 8 reps. */
export const TARGET_REPS = 8;

/** Reps 1-6 red, 7-9 yellow, 10+ green: below, on or above the target. */
export function colourForReps(reps: number): Colour {
  if (reps <= 6) return 'red';
  if (reps <= 9) return 'yellow';
  return 'green';
}
