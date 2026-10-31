import type { Colour } from './types';

export const COLOURS: readonly Colour[] = ['red', 'yellow', 'green'];

/** Target reps per colour. Red = 5, yellow = 8, green = 11. */
export const TARGET_REPS: Record<Colour, number> = { red: 5, yellow: 8, green: 11 };

/** Reps 1-6 red, 7-9 yellow, 10+ green. */
export function colourForReps(reps: number): Colour {
  if (reps <= 6) return 'red';
  if (reps <= 9) return 'yellow';
  return 'green';
}
