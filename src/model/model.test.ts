import { describe, expect, it } from 'vitest';
import { TARGET_REPS } from '../domain/colour';
import type { Equipment, Prediction } from '../domain/types';
import { e1rm, weightFor } from './curve';
import {
  DEFAULT_BODYWEIGHT_KG,
  lastColour,
  oneRepMax,
  predict,
  predictRaw,
  roundToLoadable,
  strengthHistory,
} from './index';
import { carryOver, replay } from './replay';
import { DAY_0, barbell, log, on, set, weighIn } from './testing';

const raw = (input: ReturnType<typeof barbell>, day: number) => predictRaw(input, on(day)) as Prediction;
const shown = (input: ReturnType<typeof barbell>, day: number) => predict(input, on(day)) as Prediction;
const dropPercent = (from: number, to: number) => (100 * (from - to)) / from;

describe('no entries', () => {
  it('predicts nothing', () => {
    expect(predict(barbell(), DAY_0)).toBeNull();
    expect(predictRaw(barbell(), DAY_0)).toBeNull();
    expect(oneRepMax(barbell(), DAY_0)).toBeNull();
  });

  it('ignores deleted entries and entries after the date', () => {
    expect(predict(barbell(set(0, 80, 8, { deleted: true })), DAY_0)).toBeNull();
    expect(predict(barbell(set(5, 80, 8)), DAY_0)).toBeNull();
  });
});

describe('AC7: first entry', () => {
  const first = barbell(set(0, 80, 8));

  it('shows the starting curve alone', () => {
    const { red, yellow, green } = raw(first, 0);
    expect(red).toBeGreaterThan(yellow);
    expect(yellow).toBeGreaterThan(green);
    expect(yellow).toBeCloseTo(80, 6);
    expect(Math.abs(red - 88)).toBeLessThanOrEqual(1);
    expect(Math.abs(green - 73.5)).toBeLessThanOrEqual(1);
  });

  it('stays in band once loadable', () => {
    const { red, yellow, green } = shown(first, 0);
    expect(red).toBeGreaterThan(yellow);
    expect(yellow).toBeGreaterThan(green);
    expect(Math.abs(red - 88)).toBeLessThanOrEqual(1);
    expect(yellow).toBe(80);
    expect(Math.abs(green - 73.5)).toBeLessThanOrEqual(1);
  });
});

describe('AC8: own colour moves most', () => {
  it('holds on a beat in each colour', () => {
    const base = [set(0, 80, 8), set(3, 80, 8)];
    for (const entry of [set(7, 95, 5), set(7, 86, 8), set(7, 76, 11)]) {
      const before = raw(barbell(...base), 7);
      const after = raw(barbell(...base, entry), 7);
      const colour = entry.reps === 5 ? 'red' : entry.reps === 8 ? 'yellow' : 'green';
      const moves = {
        red: Math.log(after.red / before.red),
        yellow: Math.log(after.yellow / before.yellow),
        green: Math.log(after.green / before.green),
      };
      for (const other of ['red', 'yellow', 'green'] as const) {
        if (other === colour) continue;
        expect(moves[other]).toBeGreaterThan(0);
        expect(moves[other]).toBeLessThanOrEqual(0.9 * moves[colour] + 1e-9);
      }
    }
  });
});

describe('AC9: target reps stay fixed', () => {
  it('shows red for 5 reps after an entry of 4', () => {
    const { red } = raw(barbell(set(0, 90, 4)), 0);
    expect(red).toBeLessThan(90);
    expect(e1rm(red, 5)).toBeCloseTo(e1rm(90, 4), 6);
  });
});

describe('AC10: misses count less than beats', () => {
  const base = [set(0, 100, 8), set(3, 100, 8)];
  const percentMove = (before: number, after: number) => (100 * (after - before)) / before;

  it.each([1.5, 3, 5, 8, 12])('at %f%%', (x) => {
    const start = raw(barbell(...base), 6).yellow;
    const beat = raw(barbell(...base, set(6, start * (1 + x / 100), 8)), 6).yellow;

    const firstMissSet = set(6, start * (1 - x / 100), 8);
    const afterFirst = raw(barbell(...base, firstMissSet), 9).yellow;
    const secondMissSet = set(9, afterFirst * (1 - x / 100), 8);
    const afterSecond = raw(barbell(...base, firstMissSet, secondMissSet), 9).yellow;

    const firstDrop = -percentMove(start, afterFirst);
    const secondDrop = -percentMove(afterFirst, afterSecond);
    expect(firstDrop).toBeGreaterThan(0);
    expect(firstDrop).toBeLessThan(percentMove(start, beat));
    expect(secondDrop).toBeGreaterThan(firstDrop);
  });

  it('responds to a 1st, 2nd and later miss in a row by 0.1, 0.4 and 0.7', () => {
    const misses = [set(6, 80, 8), set(9, 80, 8), set(12, 80, 8), set(15, 80, 8)];
    const strength = (count: number) =>
      replay(barbell(...base, ...misses.slice(0, count)), on(15)).state!.strength.yellow;
    const response = (count: number) =>
      Math.log(strength(count) / strength(count - 1)) / Math.log(e1rm(80, 8) / strength(count - 1));
    expect(response(1)).toBeCloseTo(0.1, 6);
    expect(response(2)).toBeCloseTo(0.4, 6);
    expect(response(3)).toBeCloseTo(0.7, 6);
    expect(response(4)).toBeCloseTo(0.7, 6);
  });

  it('ends the streak on a record', () => {
    const entries = [...base, set(6, 90, 8), set(9, 90, 8), set(12, 120, 8), set(15, 100, 8)];
    expect(replay(barbell(...entries), on(15)).state?.missStreak).toBe(1);
  });
});

describe('AC11: time away', () => {
  const settled = barbell(set(0, 100, 8), set(3, 100, 8), set(7, 100, 8));

  it.each([
    ['one entry', barbell(set(7, 100, 8))],
    ['a short log', settled],
  ])('%s', (_, input) => {
    const start = raw(input, 7);
    const day14 = raw(input, 21);
    const day60 = raw(input, 67);

    expect(dropPercent(start.red, day14.red)).toBeGreaterThan(0);
    expect(dropPercent(start.red, day14.red)).toBeLessThanOrEqual(1);
    expect(day60.red).toBeLessThan(day14.red);
    expect(day60.green).toBeLessThan(day14.green);
    expect(dropPercent(start.green, day60.green)).toBeGreaterThan(dropPercent(start.red, day60.red));
  });

  it('adds no drag on a normal weekly cadence, and calendar days add no growth', () => {
    const start = raw(settled, 7);
    expect(raw(settled, 14)).toEqual(start);
  });

  it('has green fall first and furthest at every horizon', () => {
    const start = raw(settled, 7);
    for (const days of [8, 14, 30, 60, 120, 365, 1000]) {
      const later = raw(settled, 7 + days);
      const drop = (colour: 'red' | 'yellow' | 'green') => dropPercent(start[colour], later[colour]);
      expect(drop('green')).toBeGreaterThan(drop('yellow'));
      expect(drop('yellow')).toBeGreaterThan(drop('red'));
    }
  });
});

describe('AC12: assistance', () => {
  const pullUps = log('bodyweight', [set(0, 0, 3)], [weighIn(0, 80)]);

  it('shows a negative weight when the target is out of reach', () => {
    expect(raw(pullUps, 0).green).toBeLessThan(0);
    expect(shown(pullUps, 0).green).toBeLessThan(0);
  });

  it('applies the bodyweight of each date', () => {
    const heavier = log('bodyweight', [set(0, 0, 8)], [weighIn(0, 80), weighIn(1, 90)]);
    expect(raw(heavier, 0).yellow).toBeCloseTo(0, 6);
    expect(raw(heavier, 1).yellow).toBeCloseTo(-10, 6);
  });

  it('uses the default bodyweight with no records', () => {
    const noRecords = log('bodyweight', [set(0, 10, 5)]);
    expect(oneRepMax(noRecords, DAY_0)).toBeCloseTo(e1rm(DEFAULT_BODYWEIGHT_KG + 10, 5), 6);
  });
});

describe('AC14: replay', () => {
  const entries = [set(0, 80, 8), set(4, 85, 5), set(9, 70, 11), set(13, 82.5, 8)];
  const outputs = (input: ReturnType<typeof barbell>) => ({
    predicted: predict(input, on(20)),
    raw: predictRaw(input, on(20)),
    history: strengthHistory(input, on(20)),
    oneRepMax: oneRepMax(input, on(20)),
  });

  it('treats a deleted entry as if it never existed', () => {
    const [a, b, c, d] = entries;
    expect(outputs(barbell(a, { ...b, deleted: true }, c, d))).toEqual(outputs(barbell(a, c, d)));
  });

  it('treats an edited entry as if it had always been that', () => {
    const [a, b, c, d] = entries;
    const edited = { ...b, weightKg: 87.5, updatedAt: 99 };
    expect(outputs(barbell(a, edited, c, d))).toEqual(outputs(barbell(a, edited, d, c)));
    expect(outputs(barbell(a, edited, c, d))).not.toEqual(outputs(barbell(...entries)));
  });

  it('gives the same answer for a back-dated entry in any order', () => {
    expect(outputs(barbell(...[...entries].reverse()))).toEqual(outputs(barbell(...entries)));
  });
});

describe('AC16: custom exercises', () => {
  it('needs no bank row, only the equipment and the entries', () => {
    const bank = barbell(set(0, 80, 8), set(4, 85, 8));
    const custom = barbell(...bank.entries.map((entry) => ({ ...entry, exerciseId: 'my-own-idea' })));
    expect(predict(custom, on(4))).toEqual(predict(bank, on(4)));
  });
});

describe('entry updates', () => {
  it('counts a record fully', () => {
    const before = raw(barbell(set(0, 80, 8)), 3).yellow;
    const after = raw(barbell(set(0, 80, 8), set(3, 90, 8)), 3).yellow;
    expect(before).toBeCloseTo(80, 6);
    expect(after).toBeGreaterThanOrEqual(90);
    expect(after).toBeLessThan(91);
  });

  it('carries a beat into the other colours by the prior share', () => {
    const before = raw(barbell(set(0, 80, 8)), 7);
    const after = raw(barbell(set(0, 80, 8), set(7, 76, 11)), 7);
    expect(after.yellow).toBeGreaterThan(before.yellow);
    expect(after.red).toBeGreaterThan(before.red);
    expect(after.yellow / before.yellow).toBeGreaterThan(after.red / before.red);
  });

  it('lets only the stronger of two same-date entries feed the model', () => {
    const base = [set(0, 80, 8)];
    const strong = set(4, 85, 8);
    const justStrong = predictRaw(barbell(...base, strong), on(4));
    for (const updatedAt of [1, 9]) {
      const weak = set(4, 60, 8, { updatedAt });
      expect(predictRaw(barbell(...base, weak, strong), on(4))).toEqual(justStrong);
    }
  });
});

describe('trap: the rounding band', () => {
  // Learned step 5, with raw yellow above the shown 80 kg.
  const base = [set(0, 70, 8), set(3, 80, 8), set(6, 85, 5)];
  const yellow = (entries: typeof base) => raw(barbell(...entries), 9).yellow;

  it('sets up a shown weight below raw', () => {
    expect(yellow(base)).toBeGreaterThan(80.5);
    expect(shown(barbell(...base), 9).yellow).toBe(80);
  });

  it('counts the shown weight at target reps as a hit', () => {
    const hit = [...base, set(9, 80, 8)];
    expect(replay(barbell(...hit), on(9)).state?.outcome).toBe('hit');
    expect(yellow(hit)).toBeGreaterThanOrEqual(yellow(base));
  });

  it('resets the miss streak inside the band', () => {
    const missed = [...base, set(9, 70, 8)];
    expect(replay(barbell(...missed), on(9)).state?.missStreak).toBe(1);
    const hitNext = [...missed, set(12, 80, 8)];
    expect(replay(barbell(...hitNext), on(12)).state?.missStreak).toBe(0);
  });

  it('counts a set below the shown weight as a miss', () => {
    const miss = [...base, set(9, 75, 8)];
    expect(replay(barbell(...miss), on(9)).state?.outcome).toBe('miss');
    expect(yellow(miss)).toBeLessThan(yellow(base));
  });

  it.each(['barbell', 'dumbbell', 'kettlebell', 'machine'] as Equipment[])(
    'never registers a miss when a %s user follows the app exactly',
    (equipment) => {
      for (const reps of [5, 8, 11]) {
        const colour = reps === 5 ? 'red' : reps === 8 ? 'yellow' : 'green';
        const entries = [set(0, 40, reps)];
        const shownWeights: number[] = [];
        const rawWeights: number[] = [];
        for (let session = 1; session <= 80; session++) {
          const day = Math.round(session * 3.5);
          const input = log(equipment, entries);
          const weight = (predict(input, on(day)) as Prediction)[colour];
          shownWeights.push(weight);
          rawWeights.push((predictRaw(input, on(day)) as Prediction)[colour]);
          entries.push(set(day, weight, reps));
        }
        const outcomes = replay(log(equipment, entries), on(400)).timeline.map((point) => point.outcome);
        expect(outcomes).not.toContain('miss');
        expect(rawWeights.every((weight, i) => i === 0 || weight > rawWeights[i - 1])).toBe(true);
        expect(shownWeights.at(-1)).toBeGreaterThan(40);
      }
    },
  );
});

describe('trap: growth on a miss', () => {
  it('lowers the prediction after even a small first miss', () => {
    const base = [set(0, 100, 8), set(3, 100, 8), set(6, 100, 8)];
    const before = raw(barbell(...base), 9).yellow;
    const after = raw(barbell(...base, set(9, 99, 8)), 9).yellow;
    expect(after).toBeLessThan(before);
  });
});

describe('growth', () => {
  it('floors at zero on a falling log', () => {
    const falling = barbell(set(0, 100, 8), set(4, 95, 8), set(8, 90, 8), set(12, 85, 8), set(16, 80, 8));
    const before = raw(falling, 16).yellow;
    const afterHit = raw(barbell(...falling.entries, set(20, before, 8)), 20).yellow;
    expect(afterHit).toBeGreaterThanOrEqual(before);
  });

  it('learns a faster rate from faster raw progress', () => {
    const steps = 12;
    const climbing = (gain: number) => {
      const entries = [];
      for (let i = 0; i < steps; i++) entries.push(set(i * 4, 100 * (1 + gain) ** i, 8));
      return barbell(...entries);
    };
    const hit = (input: ReturnType<typeof barbell>) => {
      const day = steps * 4;
      const before = raw(input, day).yellow;
      return raw(barbell(...input.entries, set(day, before, 8)), day).yellow / before;
    };
    expect(hit(climbing(0.02))).toBeGreaterThan(hit(climbing(0.002)));
  });

  it('does not age through a layoff', () => {
    const gap = (days: number) => {
      const entries = [set(0, 100, 8), set(4, 100, 8), set(8, 100, 8), set(8 + days, 100, 8)];
      return replay(barbell(...entries), on(8 + days)).state?.trainingAge;
    };
    expect(gap(14)).toBe(gap(200));
  });
});

describe('carry-over learning', () => {
  it('starts from the prior', () => {
    const state = replay(barbell(set(0, 80, 8)), DAY_0).state!;
    expect(carryOver(state, 'yellow', 'red')).toBe(0.5);
    expect(carryOver(state, 'yellow', 'green')).toBe(0.5);
    expect(carryOver(state, 'red', 'green')).toBe(0.25);
    expect(carryOver(state, 'green', 'red')).toBe(0.25);
  });

  const alternate = (red: (session: number) => number) => {
    const entries = [];
    for (let i = 0; i < 40; i++) {
      entries.push(set(i * 7, 80 * 1.012 ** i, 8));
      entries.push(set(i * 7 + 3, red(i), 5));
    }
    return replay(barbell(...entries), on(400)).state!;
  };

  it('falls when a colour ignores movement in another', () => {
    expect(carryOver(alternate(() => 80), 'yellow', 'red')).toBeLessThan(0.5);
  });

  it('rises when a colour follows movement in another', () => {
    const following = alternate((i) => 88 * 1.012 ** i);
    expect(carryOver(following, 'yellow', 'red')).toBeGreaterThan(0.5);
    expect(carryOver(following, 'yellow', 'red')).toBeLessThanOrEqual(0.9);
  });
});

describe('rebound', () => {
  const trained = [set(0, 100, 8), set(4, 100, 8), set(8, 100, 8), set(12, 100, 8)];

  it('returns lost strength faster than growth alone would', () => {
    const decayed = raw(barbell(...trained), 112).yellow;
    const afterHit = raw(barbell(...trained, set(112, decayed, 8)), 112).yellow;
    expect(afterHit / decayed).toBeGreaterThan(1.02);
  });

  it('repays the debt faster on a beat', () => {
    const debtAfter = (weight: number) =>
      replay(barbell(...trained, set(112, weight, 8)), on(112)).state!.debt.yellow;
    const decayed = raw(barbell(...trained), 112).yellow;
    expect(debtAfter(decayed * 1.05)).toBeLessThan(debtAfter(decayed));
  });

  it('owes nothing for a shortfall', () => {
    const state = replay(barbell(...trained, set(16, 70, 8)), on(16)).state!;
    expect(state.debt).toEqual({ red: 0, yellow: 0, green: 0 });
  });
});

describe('colour order', () => {
  it('survives an outlier', () => {
    const { red, yellow, green } = raw(barbell(set(0, 90, 5), set(4, 100, 11)), 4);
    expect(green).toBeGreaterThanOrEqual(100);
    expect(red).toBeGreaterThanOrEqual(yellow);
    expect(yellow).toBeGreaterThanOrEqual(green);
  });
});

describe('strengthHistory', () => {
  const input = barbell(set(0, 80, 8), set(4, 90, 4), set(4, 50, 12), set(60, 70, 11));

  it('has a point per session date and a final decayed point', () => {
    const { lines } = strengthHistory(input, on(120));
    for (const colour of ['red', 'yellow', 'green'] as const) {
      expect(lines[colour].map((point) => point.date)).toEqual([on(0), on(4), on(60), on(120)]);
      expect(lines[colour][3].kg).toBeLessThan(lines[colour][2].kg);
      expect(lines[colour][3].kg).toBeCloseTo((predictRaw(input, on(120)) as Prediction)[colour], 8);
    }
  });

  it('adds no extra point when asOf is the last session', () => {
    expect(strengthHistory(input, on(60)).lines.red).toHaveLength(3);
  });

  it('has a dot per live entry, normalised to target reps, including same-date sets', () => {
    const { dots } = strengthHistory(input, on(120));
    expect(dots.map((dot) => dot.colour)).toEqual(['yellow', 'red', 'green', 'green']);
    expect(dots[0].kg).toBeCloseTo(80, 6);
    expect(dots[1].kg).toBeCloseTo(weightFor(e1rm(90, 4), TARGET_REPS.red), 6);
    expect(dots[2].kg).toBeCloseTo(weightFor(e1rm(50, 12), TARGET_REPS.green), 6);
    expect(dots[0].entryId).toBe(input.entries[0].id);
  });

  it('skips deleted entries', () => {
    const withDeleted = barbell(set(0, 80, 8), set(4, 90, 8, { deleted: true }));
    expect(strengthHistory(withDeleted, on(4)).dots).toHaveLength(1);
  });

  it('reports logged terms', () => {
    const dumbbell = strengthHistory(log('dumbbell', [set(0, 20, 8)]), on(0));
    expect(dumbbell.lines.yellow[0].kg).toBeCloseTo(20, 6);
    expect(dumbbell.dots[0].kg).toBeCloseTo(20, 6);

    const bodyweight = strengthHistory(log('bodyweight', [set(0, -10, 8)], [weighIn(0, 80)]), on(0));
    expect(bodyweight.lines.yellow[0].kg).toBeCloseTo(-10, 6);
    expect(bodyweight.dots[0].kg).toBeCloseTo(-10, 6);
  });

  it('is empty with no entries', () => {
    expect(strengthHistory(barbell(), DAY_0)).toEqual({
      lines: { red: [], yellow: [], green: [] },
      dots: [],
    });
  });
});

describe('oneRepMax', () => {
  it('uses logged terms', () => {
    expect(oneRepMax(barbell(set(0, 80, 8)), DAY_0)).toBeCloseTo(e1rm(80, 8), 6);
    expect(oneRepMax(log('dumbbell', [set(0, 20, 8)]), DAY_0)).toBeCloseTo(e1rm(40, 8) / 2, 6);
    expect(oneRepMax(log('bodyweight', [set(0, 10, 5)], [weighIn(0, 75)]), DAY_0)).toBeCloseTo(
      e1rm(85, 5),
      6,
    );
  });

  it('takes the current colour', () => {
    const input = barbell(set(0, 80, 8), set(4, 90, 8), set(8, 40, 12));
    const state = replay(input, on(8)).state!;
    expect(oneRepMax(input, on(8))).toBeCloseTo(state.strength.green, 6);
  });
});

describe('lastColour', () => {
  it('is yellow with no entries', () => {
    expect(lastColour([])).toBe('yellow');
    expect(lastColour([set(0, 80, 5, { deleted: true })])).toBe('yellow');
  });

  it('takes the last entry by date, then updatedAt', () => {
    expect(lastColour([set(4, 80, 5), set(0, 70, 11)])).toBe('red');
    expect(lastColour([set(0, 80, 5, { updatedAt: 9 }), set(0, 70, 11, { updatedAt: 3 })])).toBe('red');
  });
});

describe('roundToLoadable', () => {
  it('is exported for callers', () => {
    expect(roundToLoadable(88, 'barbell', [80])).toBe(87.5);
  });
});
