import { describe, expect, it } from 'vitest';
import { PERSONAS, percentageErrors, simulate } from './simulator';

const SEEDS = 150;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const meanAbsolute = (values: number[]) => mean(values.map(Math.abs));

describe('AC17: simulated 12-month logs', () => {
  it.each(PERSONAS)('prediction error falls for: $name', (persona) => {
    const first: number[] = [];
    const last: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const errors = percentageErrors(simulate(persona, seed));
      first.push(meanAbsolute(errors.slice(0, 5)));
      last.push(meanAbsolute(errors.slice(-20)));
    }
    expect(mean(last)).toBeLessThan(mean(first));
  });

  // Beats count fully and misses barely do, so noise ratchets the estimate upwards. Whole
  // reps hide that, so this logs exact capability and shows the offset settles, not grows.
  it('keeps the noise ratchet a small, stable offset', () => {
    const middle: number[] = [];
    const last: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const errors = percentageErrors(simulate(PERSONAS[0], seed, true));
      middle.push(mean(errors.slice(30, 50)));
      last.push(mean(errors.slice(-20)));
    }
    expect(mean(last)).toBeGreaterThan(0);
    expect(mean(last)).toBeLessThan(1.5);
    expect(mean(last) - mean(middle)).toBeLessThan(0.3);
  });
});
