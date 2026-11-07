import { describe, expect, it } from 'vitest';
import { PERSONAS, percentageErrors, simulate } from './simulator';

const SEEDS = 150;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const meanAbsolute = (values: number[]) => mean(values.map(Math.abs));

// Each persona trains more than one colour. One that trains a single colour and always loads
// the suggestion stalls about one plate behind, which SPEC.md accepts.
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
});
