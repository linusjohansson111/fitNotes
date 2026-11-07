import { describe, expect, it } from 'vitest';
import { TARGET_REPS } from '../domain/colour';
import type { Colour, Entry, Prediction } from '../domain/types';
import { e1rm, weightFor } from './curve';
import {
  DEFAULT_BODYWEIGHT_KG,
  type ModelInput,
  lastColour,
  oneRepMax,
  predict,
  predictRaw,
  roundToLoadable,
  strengthHistory,
} from './index';
import { DAY_0, barbell, log, on, set, weighIn } from './testing';

const raw = (input: ModelInput, day: number) => predictRaw(input, on(day)) as Prediction;
const shown = (input: ModelInput, day: number) => predict(input, on(day)) as Prediction;
/** The e1RM a predicted weight stands for, so moves compare on the fitted scale. */
const strength = (input: ModelInput, day: number, colour: Colour) => e1rm(raw(input, day)[colour], TARGET_REPS[colour]);

/** `count` sessions of `weight` x 8, three days apart from day 0. */
function flat(count: number, weight = 100): Entry[] {
  return Array.from({ length: count }, (_, i) => set(i * 3, weight, 8));
}

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
  /** Each colour's move in e1RM terms, the model's own scale. */
  function moves(base: Entry[], entry: Entry): Record<Colour, number> {
    const day = Math.round((Date.parse(entry.date) - Date.parse(DAY_0)) / 86_400_000);
    const move = (colour: Colour) =>
      Math.log(strength(barbell(...base, entry), day, colour) / strength(barbell(...base), day, colour));
    return { red: move('red'), yellow: move('yellow'), green: move('green') };
  }
  const colourOf = (entry: Entry): Colour => (entry.reps <= 6 ? 'red' : entry.reps <= 9 ? 'yellow' : 'green');

  it('moves a new colour most, and the others partly', () => {
    const base = [set(0, 80, 8), set(3, 80, 8)];
    for (const entry of [set(7, 95, 5), set(7, 76, 11)]) {
      const move = moves(base, entry);
      for (const other of ['red', 'yellow', 'green'] as const) {
        if (other === colourOf(entry)) continue;
        expect(move[other]).toBeGreaterThan(0);
        expect(move[other]).toBeLessThan(move[colourOf(entry)]);
      }
    }
  });

  it('moves every colour alike while only one colour has data', () => {
    const move = moves([set(0, 80, 8), set(3, 80, 8)], set(7, 86, 8));
    expect(move.yellow).toBeGreaterThan(0);
    expect(move.red).toBeCloseTo(move.yellow, 12);
    expect(move.green).toBeCloseTo(move.yellow, 12);
  });

  it('moves its own colour most when every colour has data', () => {
    const base = [set(0, 80, 8), set(3, 88, 5), set(6, 73.5, 11), set(9, 80, 8), set(12, 88, 5), set(15, 73.5, 11)];
    for (const entry of [set(18, 84, 8), set(18, 92, 5), set(18, 77, 11), set(18, 76, 8), set(18, 70, 11)]) {
      const move = moves(base, entry);
      for (const other of ['red', 'yellow', 'green'] as const) {
        if (other === colourOf(entry)) continue;
        expect(Math.abs(move[other])).toBeLessThan(Math.abs(move[colourOf(entry)]));
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

describe('AC10: above and below the trend count alike', () => {
  const base = [set(0, 100, 8), set(3, 102, 8), set(6, 101, 8), set(9, 104, 8), set(12, 103, 8)];

  it.each([1, 3, 8, 20])('moves the next prediction equal and opposite at %f%%', (percent) => {
    const onTrend = strength(barbell(...base), 15, 'yellow');
    const landing = (sign: number) => {
      const weight = weightFor(onTrend * Math.exp((sign * percent) / 100), 8);
      return strength(barbell(...base, set(15, weight, 8)), 15, 'yellow');
    };
    const unmoved = landing(0);
    const up = Math.log(landing(1) / unmoved);
    const down = Math.log(landing(-1) / unmoved);
    expect(up).toBeGreaterThan(0);
    expect(down).toBeCloseTo(-up, 10);
  });
});

describe('AC11: sessions, not calendar time', () => {
  it.each([
    ['one entry', [set(0, 100, 8)]],
    ['a log', [set(0, 100, 8), set(3, 104, 5), set(7, 90, 11)]],
  ])('predicts the same 60 days on as the day after, for %s', (_, entries) => {
    const input = barbell(...entries);
    const last = Math.max(...entries.map((entry) => Math.round((Date.parse(entry.date) - Date.parse(DAY_0)) / 86_400_000)));
    expect(raw(input, last + 60)).toEqual(raw(input, last + 1));
    expect(shown(input, last + 60)).toEqual(shown(input, last + 1));
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

describe('bodyweight share', () => {
  it('loads share × bodyweight + added', () => {
    const pushUps = log('bodyweight', [set(0, 10, 5)], [weighIn(0, 80)], { bodyweightShare: 0.65 });
    expect(oneRepMax(pushUps, DAY_0)).toBeCloseTo(e1rm(0.65 * 80 + 10, 5), 6);
  });

  it('AC32: suggests less added weight for a share under 1 at the same reps', () => {
    const at = (share: number) =>
      raw(log('bodyweight', [set(0, 0, 20)], [weighIn(0, 80)], { bodyweightShare: share }), 0).red;
    expect(at(0.65)).toBeLessThan(at(1));
    expect(at(0.65)).toBeGreaterThan(0);
  });

  it('keeps assistance from reaching the share of bodyweight', () => {
    const rows = log('bodyweight', [set(0, -40, 3)], [weighIn(0, 80)], { bodyweightShare: 0.6 });
    expect(shown(rows, 0).green).toBeGreaterThan(-48);
  });
});

describe('per hand', () => {
  it('doubles the load for the curve and halves it back for the map', () => {
    const pair = log('dumbbell', [set(0, 20, 8)], [], { perHand: true });
    const single = log('dumbbell', [set(0, 20, 8)], [], { perHand: false });
    expect(oneRepMax(pair, DAY_0)).toBeCloseTo(e1rm(40, 8) / 2, 6);
    expect(oneRepMax(single, DAY_0)).toBeCloseTo(e1rm(20, 8), 6);
    expect(raw(pair, 0).yellow).toBeCloseTo(20, 6);
    expect(raw(pair, 0).red).not.toBeCloseTo(raw(single, 0).red, 2);
  });
});

describe('AC14: replay', () => {
  const entries = [set(0, 80, 8), set(4, 85, 5), set(9, 70, 11), set(13, 82.5, 8)];
  const outputs = (input: ModelInput) => ({
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

describe('AC16: any exercise', () => {
  it('needs only the loading and the entries', () => {
    const one = barbell(set(0, 80, 8), set(4, 85, 8));
    const other = barbell(...one.entries.map((entry) => ({ ...entry, exerciseId: 'another-lift' })));
    expect(predict(other, on(4))).toEqual(predict(one, on(4)));
  });
});

describe('AC26: a run of sessions under or over', () => {
  /** Logs `count` sessions after `entries`, each `factor` times the yellow prediction before it. */
  function run(entries: Entry[], factor: number, count = 6): { before: number; after: number } {
    const log = [...entries];
    let day = 3 * entries.length;
    const before = raw(barbell(...log), day).yellow;
    for (let i = 0; i < count; i++) {
      log.push(set(day, raw(barbell(...log), day).yellow * factor, 8));
      day += 3;
    }
    return { before, after: raw(barbell(...log), day).yellow };
  }
  const rising = Array.from({ length: 12 }, (_, i) => set(i * 3, 80 * Math.exp(0.005 * i), 8));

  it.each([
    ['a flat log', flat(6)],
    ['a log rising 0.5% a session', rising],
  ])('predicts lower after six sessions 2%% under, on %s', (_, entries) => {
    const { before, after } = run(entries, 0.98);
    expect(after).toBeLessThan(before);
  });

  it.each([
    ['a flat log', flat(6)],
    ['a log rising 0.5% a session', rising],
  ])('predicts higher after six sessions 2%% over, on %s', (_, entries) => {
    const { before, after } = run(entries, 1.02);
    expect(after).toBeGreaterThan(before);
  });

  it('lowers the prediction after one low day', () => {
    const before = raw(barbell(...flat(4)), 12).yellow;
    expect(raw(barbell(...flat(4), set(12, 99, 8)), 12).yellow).toBeLessThan(before);
  });
});

describe('AC27: K starts at 0%', () => {
  it('predicts the same e1RM after two equal sessions', () => {
    const first = e1rm(80, 8);
    const twoEqual = barbell(set(0, 80, 8), set(3, weightFor(first, 6), 6));
    for (const colour of ['red', 'yellow', 'green'] as const) {
      expect(strength(twoEqual, 3, colour)).toBeCloseTo(first, 8);
    }
  });

  it('lets data replace it within about three sessions', () => {
    const k = (count: number) => {
      const growing = barbell(...Array.from({ length: count }, (_, i) => set(i * 3, 100 * 1.02 ** i, 8)));
      const [first, second] = strengthHistory(growing, on(count * 3)).lines.yellow.map((point) => e1rm(point.kg, 8));
      return Math.log(second / first);
    };
    expect(k(2)).toBeLessThan(0.5 * Math.log(1.02));
    expect(k(3)).toBeGreaterThan(0.6 * Math.log(1.02));
    expect(k(6)).toBeGreaterThan(0.85 * Math.log(1.02));
  });
});

describe('AC28: an outlier only adjusts the fit', () => {
  it('raises the next prediction part of the way to it', () => {
    const before = raw(barbell(...flat(8)), 24).yellow;
    const after = raw(barbell(...flat(8), set(24, 130, 8)), 24).yellow;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(130);
  });

  it('lets later sessions undo it', () => {
    const outlier = [...flat(8), set(24, 130, 8)];
    const recovered = [...outlier, set(27, 100, 8), set(30, 100, 8), set(33, 100, 8)];
    expect(raw(barbell(...recovered), 33).yellow).toBeLessThan(raw(barbell(...outlier), 24).yellow);
  });
});

describe('entry updates', () => {
  it('lets only the stronger of two same-date entries feed the model', () => {
    const base = [set(0, 80, 8)];
    const strong = set(4, 85, 8);
    const justStrong = predictRaw(barbell(...base, strong), on(4));
    for (const updatedAt of [1, 9]) {
      const weak = set(4, 60, 8, { updatedAt });
      expect(predictRaw(barbell(...base, weak, strong), on(4))).toEqual(justStrong);
    }
  });

  it('carries a session into colours not trained', () => {
    const before = raw(barbell(set(0, 80, 8)), 7);
    const after = raw(barbell(set(0, 80, 8), set(7, 76, 11)), 7);
    expect(after.yellow).toBeGreaterThan(before.yellow);
    expect(after.red).toBeGreaterThan(before.red);
  });
});

describe('colour order', () => {
  it('survives an outlier', () => {
    const { red, yellow, green } = raw(barbell(set(0, 90, 5), set(4, 100, 11)), 4);
    expect(red).toBeGreaterThanOrEqual(yellow);
    expect(yellow).toBeGreaterThanOrEqual(green);
  });
});

describe('AC29: real weights', () => {
  const press = (entries: Entry[], rackWeights: number[] = []) =>
    shown(log('dumbbell', entries, [], { perHand: true, rackWeights }), 7);

  it('shows only grid or logged dumbbell weights, never 39.5 or 33.5', () => {
    const shownWeights = Object.values(press([set(0, 40, 4), set(3, 37.5, 8)], [22, 26]));
    for (const weight of shownWeights) {
      expect([39.5, 33.5]).not.toContain(weight);
      expect(weight % 2.5 === 0 || [22, 26, 40, 37.5].includes(weight)).toBe(true);
    }
  });

  it('snaps to a dumbbell logged on another exercise', () => {
    const entries = [set(0, 22, 6)];
    const near = raw(log('dumbbell', entries, [], { perHand: true }), 7).yellow;
    const offGrid = Math.round(near * 10) / 10 + 0.05;
    expect(offGrid % 2.5).not.toBe(0);
    expect(press(entries, [offGrid]).yellow).toBe(offGrid);
    expect(press(entries).yellow % 2.5).toBe(0);
  });
});

describe('strengthHistory', () => {
  const input = barbell(set(0, 80, 8), set(4, 90, 4), set(4, 50, 12), set(60, 70, 11));

  it('draws the current fit at each session date, ending at asOf on the next suggestion', () => {
    const { lines } = strengthHistory(input, on(120));
    for (const colour of ['red', 'yellow', 'green'] as const) {
      expect(lines[colour].map((point) => point.date)).toEqual([on(0), on(4), on(60), on(120)]);
      expect(lines[colour][3].kg).toBeCloseTo((predictRaw(input, on(120)) as Prediction)[colour], 8);
    }
  });

  it('ends on the next suggestion when asOf is the last session', () => {
    const { lines } = strengthHistory(input, on(60));
    expect(lines.red.map((point) => point.date)).toEqual([on(0), on(4), on(60)]);
    expect(lines.red[2].kg).toBeCloseTo((predictRaw(input, on(60)) as Prediction).red, 8);
  });

  it('draws a straight trend in log terms, its slope K', () => {
    const growing = barbell(...Array.from({ length: 6 }, (_, i) => set(i * 3, 100 * 1.02 ** i, 8)));
    const kg = strengthHistory(growing, on(18)).lines.yellow.map((point) => e1rm(point.kg, 8));
    const steps = kg.slice(1).map((value, i) => Math.log(value / kg[i]));
    for (const step of steps) expect(step).toBeCloseTo(steps[0], 8);
    expect(steps[0]).toBeGreaterThan(0);
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
    const dumbbell = strengthHistory(log('dumbbell', [set(0, 20, 8)], [], { perHand: true }), on(0));
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
    expect(oneRepMax(log('bodyweight', [set(0, 10, 5)], [weighIn(0, 75)]), DAY_0)).toBeCloseTo(e1rm(85, 5), 6);
  });

  it('takes the current colour', () => {
    const input = barbell(set(0, 80, 8), set(4, 90, 8), set(8, 40, 12));
    expect(oneRepMax(input, on(8))).toBeCloseTo(strength(input, 8, 'green'), 6);
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
