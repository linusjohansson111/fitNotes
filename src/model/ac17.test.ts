import { describe, expect, it } from 'vitest';
import { PERSONAS, percentageErrors, simulate } from './simulator';

const SEEDS = 150;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const meanAbsolute = (values: number[]) => mean(values.map(Math.abs));

// Each persona aims at 8 reps and loads the suggestion, and the reps reached vary around 8.
describe('AC17: simulated 12-month logs', () => {
  it.each(PERSONAS)('prediction error falls for: $name', (persona) => {
    const first: number[] = [];
    const last: number[] = [];
    const reps: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const sessions = simulate(persona, seed);
      const errors = percentageErrors(sessions);
      first.push(meanAbsolute(errors.slice(0, 5)));
      last.push(meanAbsolute(errors.slice(-20)));
      reps.push(...sessions.map((session) => session.reps));
    }
    expect(mean(last)).toBeLessThan(mean(first));
    // The reps reached vary around 8: at least a tenth of sessions land on either side.
    expect(reps.filter((count) => count < 8).length).toBeGreaterThan(reps.length / 10);
    expect(reps.filter((count) => count > 8).length).toBeGreaterThan(reps.length / 10);
  });
});
