import { describe, expect, it } from 'vitest';
import { TARGET_REPS } from '../domain/colour';
import type { Entry } from '../domain/types';
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

const raw = (input: ModelInput, day: number) => predictRaw(input, on(day)) as number;
const shown = (input: ModelInput, day: number) => predict(input, on(day)) as number;
/** The e1RM a predicted weight stands for, so moves compare on the fitted scale. */
const strength = (input: ModelInput, day: number) => e1rm(raw(input, day), TARGET_REPS);

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
  it('suggests 80 kg after 80 kg x 8', () => {
    const first = barbell(set(0, 80, 8));
    expect(raw(first, 0)).toBeCloseTo(80, 6);
    expect(shown(first, 0)).toBe(80);
  });

  it('turns 100 kg x 5 into 8-rep strength on the starting curve, with no per-colour correction', () => {
    expect(raw(barbell(set(0, 100, 5)), 0)).toBeCloseTo(weightFor(e1rm(100, 5), 8), 8);
  });
});

describe('AC8: one trend from every session', () => {
  it('makes oneRepMax the e1RM of the unrounded 8-rep suggestion, in logged terms', () => {
    const entries = [set(0, 80, 8), set(4, 90, 4), set(8, 60, 14)];
    const bar = barbell(...entries);
    expect(oneRepMax(bar, on(8))).toBeCloseTo(e1rm(raw(bar, 8), 8), 6);

    const pair = log('dumbbell', entries, [], { perHand: true });
    expect(oneRepMax(pair, on(8))).toBeCloseTo(e1rm(2 * raw(pair, 8), 8) / 2, 6);

    const dips = log('bodyweight', entries.map((entry) => ({ ...entry, weightKg: entry.weightKg - 70 })), [weighIn(0, 80)], {
      bodyweightShare: 0.9,
    });
    expect(oneRepMax(dips, on(8))).toBeCloseTo(e1rm(0.9 * 80 + raw(dips, 8), 8), 6);
  });

  it('never reads a change of reps alone as progress', () => {
    const level = e1rm(100, 8);
    const mixed = barbell(...[5, 11, 8, 3, 14].map((reps, i) => set(i * 3, weightFor(level, reps), reps)));
    expect(strength(mixed, 12)).toBeCloseTo(level, 6);
  });

  it('learns K from sessions at any reps', () => {
    const growing = barbell(
      ...[5, 11, 8, 5, 11, 8].map((reps, i) => set(i * 3, weightFor(100 * 1.02 ** i, reps), reps)),
    );
    const [first, second] = strengthHistory(growing, on(18)).line.map((point) => e1rm(point.kg, 8));
    expect(Math.log(second / first)).toBeGreaterThan(0.85 * Math.log(1.02));
  });
});

describe('AC9: the target stays 8 reps', () => {
  it('suggests the weight for 8 reps after an entry of 4', () => {
    const suggested = raw(barbell(set(0, 90, 4)), 0);
    expect(suggested).toBeLessThan(90);
    expect(e1rm(suggested, 8)).toBeCloseTo(e1rm(90, 4), 6);
  });
});

describe('AC10: above and below the trend count alike', () => {
  const base = [set(0, 100, 8), set(3, 102, 8), set(6, 101, 8), set(9, 104, 8), set(12, 103, 8)];

  it.each([1, 3, 8, 20])('moves the next prediction equal and opposite at %f%%', (percent) => {
    const onTrend = strength(barbell(...base), 15);
    const landing = (sign: number) => {
      const weight = weightFor(onTrend * Math.exp((sign * percent) / 100), 8);
      return strength(barbell(...base, set(15, weight, 8)), 15);
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
    expect(raw(pullUps, 0)).toBeLessThan(0);
    expect(shown(pullUps, 0)).toBeLessThan(0);
  });

  it('applies the bodyweight of each date', () => {
    const heavier = log('bodyweight', [set(0, 0, 8)], [weighIn(0, 80), weighIn(1, 90)]);
    expect(raw(heavier, 0)).toBeCloseTo(0, 6);
    expect(raw(heavier, 1)).toBeCloseTo(-10, 6);
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
      raw(log('bodyweight', [set(0, 0, 20)], [weighIn(0, 80)], { bodyweightShare: share }), 0);
    expect(at(0.65)).toBeLessThan(at(1));
    expect(at(0.65)).toBeGreaterThan(0);
  });

  it('keeps assistance from reaching the share of bodyweight', () => {
    const rows = log('bodyweight', [set(0, -40, 3)], [weighIn(0, 80)], { bodyweightShare: 0.6 });
    expect(shown(rows, 0)).toBeGreaterThan(-48);
  });
});

describe('per hand', () => {
  it('doubles the load for the curve and halves it back for the map', () => {
    const pair = log('dumbbell', [set(0, 20, 8)], [], { perHand: true });
    const single = log('dumbbell', [set(0, 20, 8)], [], { perHand: false });
    expect(oneRepMax(pair, DAY_0)).toBeCloseTo(e1rm(40, 8) / 2, 6);
    expect(oneRepMax(single, DAY_0)).toBeCloseTo(e1rm(20, 8), 6);
    expect(raw(pair, 0)).toBeCloseTo(20, 6);
    const pairOf5 = log('dumbbell', [set(0, 20, 5)], [], { perHand: true });
    const singleOf5 = log('dumbbell', [set(0, 20, 5)], [], { perHand: false });
    expect(raw(pairOf5, 0)).not.toBeCloseTo(raw(singleOf5, 0), 2);
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
  /** Logs `count` sessions after `entries`, each `factor` times the prediction before it. */
  function run(entries: Entry[], factor: number, count = 6): { before: number; after: number } {
    const log = [...entries];
    let day = 3 * entries.length;
    const before = raw(barbell(...log), day);
    for (let i = 0; i < count; i++) {
      log.push(set(day, raw(barbell(...log), day) * factor, 8));
      day += 3;
    }
    return { before, after: raw(barbell(...log), day) };
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
    const before = raw(barbell(...flat(4)), 12);
    expect(raw(barbell(...flat(4), set(12, 99, 8)), 12)).toBeLessThan(before);
  });
});

describe('AC27: K starts at 0%', () => {
  it('predicts the same e1RM after two equal sessions', () => {
    const first = e1rm(80, 8);
    const twoEqual = barbell(set(0, 80, 8), set(3, weightFor(first, 6), 6));
    expect(strength(twoEqual, 3)).toBeCloseTo(first, 8);
  });

  it('lets data replace it within about three sessions', () => {
    const k = (count: number) => {
      const growing = barbell(...Array.from({ length: count }, (_, i) => set(i * 3, 100 * 1.02 ** i, 8)));
      const [first, second] = strengthHistory(growing, on(count * 3)).line.map((point) => e1rm(point.kg, 8));
      return Math.log(second / first);
    };
    expect(k(2)).toBeLessThan(0.5 * Math.log(1.02));
    expect(k(3)).toBeGreaterThan(0.6 * Math.log(1.02));
    expect(k(6)).toBeGreaterThan(0.85 * Math.log(1.02));
  });
});

describe('AC28: an outlier only adjusts the fit', () => {
  it('raises the next prediction part of the way to it', () => {
    const before = raw(barbell(...flat(8)), 24);
    const after = raw(barbell(...flat(8), set(24, 130, 8)), 24);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(130);
  });

  it('lets later sessions undo it', () => {
    const outlier = [...flat(8), set(24, 130, 8)];
    const recovered = [...outlier, set(27, 100, 8), set(30, 100, 8), set(33, 100, 8)];
    expect(raw(barbell(...recovered), 33)).toBeLessThan(raw(barbell(...outlier), 24));
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
});

describe('AC29: real weights', () => {
  const press = (entries: Entry[], rackWeights: number[] = []) =>
    shown(log('dumbbell', entries, [], { perHand: true, rackWeights }), 7);

  it('shows only grid or logged dumbbell weights, never 39.5 or 33.5', () => {
    for (const entries of [[set(0, 40, 4), set(3, 37.5, 8)], [set(0, 40, 4)], [set(0, 37.5, 8), set(3, 40, 4)]]) {
      const weight = press(entries, [22, 26]);
      expect([39.5, 33.5]).not.toContain(weight);
      expect(weight % 2.5 === 0 || [22, 26, 40, 37.5].includes(weight)).toBe(true);
    }
  });

  it('snaps to a dumbbell logged on another exercise', () => {
    const entries = [set(0, 22, 6)];
    const near = raw(log('dumbbell', entries, [], { perHand: true }), 7);
    const offGrid = Math.round(near * 10) / 10 + 0.05;
    expect(offGrid % 2.5).not.toBe(0);
    expect(press(entries, [offGrid])).toBe(offGrid);
    expect(press(entries) % 2.5).toBe(0);
  });
});

describe('strengthHistory', () => {
  const input = barbell(set(0, 80, 8), set(4, 90, 4), set(4, 50, 12), set(60, 70, 11));

  it('draws the current fit at each session date, ending at asOf on the next suggestion', () => {
    const { line } = strengthHistory(input, on(120));
    expect(line.map((point) => point.date)).toEqual([on(0), on(4), on(60), on(120)]);
    expect(line[3].kg).toBeCloseTo(raw(input, 120), 8);
  });

  it('ends on the next suggestion when asOf is the last session', () => {
    const { line } = strengthHistory(input, on(60));
    expect(line.map((point) => point.date)).toEqual([on(0), on(4), on(60)]);
    expect(line[2].kg).toBeCloseTo(raw(input, 60), 8);
  });

  it('draws a straight trend in log terms, its slope K', () => {
    const growing = barbell(...Array.from({ length: 6 }, (_, i) => set(i * 3, 100 * 1.02 ** i, 8)));
    const kg = strengthHistory(growing, on(18)).line.map((point) => e1rm(point.kg, 8));
    const steps = kg.slice(1).map((value, i) => Math.log(value / kg[i]));
    for (const step of steps) expect(step).toBeCloseTo(steps[0], 8);
    expect(steps[0]).toBeGreaterThan(0);
  });

  it('has a dot per live entry at its 8-rep equivalent, coloured by its own reps', () => {
    const { dots } = strengthHistory(input, on(120));
    expect(dots.map((dot) => dot.colour)).toEqual(['yellow', 'red', 'green', 'green']);
    expect(dots[0].kg).toBeCloseTo(80, 6);
    expect(dots[1].kg).toBeCloseTo(weightFor(e1rm(90, 4), 8), 6);
    expect(dots[2].kg).toBeCloseTo(weightFor(e1rm(50, 12), 8), 6);
    expect(dots[0].entryId).toBe(input.entries[0].id);
  });

  it('skips deleted entries', () => {
    const withDeleted = barbell(set(0, 80, 8), set(4, 90, 8, { deleted: true }));
    expect(strengthHistory(withDeleted, on(4)).dots).toHaveLength(1);
  });

  it('reports logged terms', () => {
    const dumbbell = strengthHistory(log('dumbbell', [set(0, 20, 8)], [], { perHand: true }), on(0));
    expect(dumbbell.line[0].kg).toBeCloseTo(20, 6);
    expect(dumbbell.dots[0].kg).toBeCloseTo(20, 6);

    const bodyweight = strengthHistory(log('bodyweight', [set(0, -10, 8)], [weighIn(0, 80)]), on(0));
    expect(bodyweight.line[0].kg).toBeCloseTo(-10, 6);
    expect(bodyweight.dots[0].kg).toBeCloseTo(-10, 6);
  });

  it('is empty with no entries', () => {
    expect(strengthHistory(barbell(), DAY_0)).toEqual({ line: [], dots: [] });
  });
});

describe('oneRepMax', () => {
  it('uses logged terms', () => {
    expect(oneRepMax(barbell(set(0, 80, 8)), DAY_0)).toBeCloseTo(e1rm(80, 8), 6);
    expect(oneRepMax(log('bodyweight', [set(0, 10, 5)], [weighIn(0, 75)]), DAY_0)).toBeCloseTo(e1rm(85, 5), 6);
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
