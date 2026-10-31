import { describe, expect, it } from 'vitest';
import { colourForReps } from './colour';

describe('colourForReps', () => {
  it.each([
    [1, 'red'],
    [6, 'red'],
    [7, 'yellow'],
    [9, 'yellow'],
    [10, 'green'],
    [20, 'green'],
  ])('%i reps is %s', (reps, colour) => {
    expect(colourForReps(reps)).toBe(colour);
  });
});
