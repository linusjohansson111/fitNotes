import { describe, expect, it } from 'vitest';
import { e1rm, weightFor } from './curve';

describe('e1rm', () => {
  it('is the weight itself at one rep', () => {
    expect(e1rm(100, 1)).toBe(100);
  });

  it('matches the published curve above the clamp', () => {
    const expected = 80 * (1 + 7 ** 0.85 / (-2.55 + 4.58 * Math.log(80)));
    expect(e1rm(80, 8)).toBeCloseTo(expected, 10);
  });

  it('is continuous and increasing in weight from 0.5 to 500 kg for reps 1 to 30', () => {
    let broken = 0;
    for (let reps = 1; reps <= 30; reps++) {
      for (let weight = 0.5; weight <= 500; weight *= 1.001) {
        const ratio = e1rm(weight * 1.001, reps) / e1rm(weight, reps);
        if (ratio <= 1 || ratio > 1.002) broken++;
      }
    }
    expect(broken).toBe(0);
  });
});

describe('weightFor', () => {
  it('inverts e1rm', () => {
    for (const weight of [0.5, 2, 5, 5.2, 10, 40, 80, 250, 500]) {
      for (const reps of [1, 5, 8, 11, 30]) {
        expect(weightFor(e1rm(weight, reps), reps)).toBeCloseTo(weight, 8);
      }
    }
  });
});
