import { describe, expect, it } from 'vitest';
import { PRIMARY_FILL, SECONDARY_FILL, muscleFills } from './muscles';

describe('AC3: muscle fills', () => {
  it('fills primary brighter than secondary, primary winning a muscle listed as both', () => {
    expect(muscleFills(['chest', 'abs'], ['triceps', 'abs'])).toEqual({
      chest: PRIMARY_FILL,
      abs: PRIMARY_FILL,
      triceps: SECONDARY_FILL,
    });
    expect(PRIMARY_FILL).toBe('#ffffff');
    expect(SECONDARY_FILL).toBe('#636366');
  });
});
