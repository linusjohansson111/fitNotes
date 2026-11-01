import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../data';
import type { ExerciseDef, Group, Muscle } from '../domain/types';
import {
  BASE_LIFTS,
  CONFIDENCE_WEIGHT,
  LEVEL_NAMES,
  RAISES,
  balanceColour,
  muscleBalance,
  muscleDetail,
  type LiftStrength,
} from './index';

const BODYWEIGHTS = [60, 72.5, 80, 83, 100, 120];
const LEVELS = [-0.5, 0, 0.25, 0.5, 1, 1.4, 2, 2.75, 3, 3.5, 4, 4.5];
const YELLOW = '#ffd60a';
const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';
const PUSHDOWN = 'Triceps_Pushdown';

const bank = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

function row(id: string): ExerciseDef {
  const found = bank.get(id);
  if (!found) throw new Error(`No row ${id}`);
  return found;
}

/**
 * A row's raised value, worked out level-first: the code under test goes
 * bodyweight-first, and both must meet at the same number.
 */
function tableKg(exercise: ExerciseDef, bodyweightKg: number, level: number): number {
  const classes = BASE_LIFTS[exercise.baseLift];
  const bodyweights = Object.keys(classes).map(Number);
  const below = Math.max(...bodyweights.filter((bodyweight) => bodyweight <= bodyweightKg));
  const above = Math.min(...bodyweights.filter((bodyweight) => bodyweight >= bodyweightKg));
  const lower = Math.min(3, Math.max(0, Math.floor(level)));
  const atLevel = (kg: number[]): number => kg[lower] + (kg[lower + 1] - kg[lower]) * (level - lower);
  const low = atLevel(classes[below]);
  const high = atLevel(classes[above]);
  const share = above === below ? 0 : (bodyweightKg - below) / (above - below);
  return (low + (high - low) * share) * exercise.ratio * RAISES[exercise.group];
}

const lift = (id: string, level: number, bodyweightKg = 80): LiftStrength => ({
  exerciseId: id,
  oneRepMaxKg: tableKg(row(id), bodyweightKg, level),
});

/** Every exercise in the bank at one level. */
const everyLiftAt = (level: number, bodyweightKg: number): LiftStrength[] =>
  EXERCISES.map(({ id }) => lift(id, level, bodyweightKg));

const BASE_ROWS = EXERCISES.filter(({ reason }) => reason.startsWith('Base lift')).map(({ id }) => id);

/** The base lifts at level 2, and one more lift off them by `delta`. */
const shifted = (id: string, delta: number): LiftStrength[] => [
  ...BASE_ROWS.map((baseRow) => lift(baseRow, 2)),
  lift(id, 2 + delta),
];

/** Red and green channels of a #rrggbb colour. */
function channels(colour: string): { red: number; green: number } {
  return {
    red: Number.parseInt(colour.slice(1, 3), 16),
    green: Number.parseInt(colour.slice(3, 5), 16),
  };
}

describe('BASE_LIFTS', () => {
  it('holds the 11 lifts of the spec', () => {
    expect(Object.keys(BASE_LIFTS).sort()).toEqual(
      [
        'Back Squat',
        'Bench Press',
        'Chin-Up',
        'Deadlift',
        'Dip',
        'Front Squat',
        'Incline Bench Press',
        'Overhead Press',
        'Pendlay Row',
        'Pull-Up',
        'Sumo Deadlift',
      ].sort(),
    );
  });

  it('has one value per named level, rising with level', () => {
    for (const [name, classes] of Object.entries(BASE_LIFTS)) {
      for (const [bodyweight, kg] of Object.entries(classes)) {
        expect(kg, `${name} at ${bodyweight}`).toHaveLength(LEVEL_NAMES.length);
        for (let level = 1; level < kg.length; level += 1) {
          expect(kg[level], `${name} at ${bodyweight}`).toBeGreaterThan(kg[level - 1]);
        }
      }
    }
  });

  it('holds the published gym percentiles at p10, p25, p50, p75 and p95', () => {
    expect(BASE_LIFTS['Bench Press'][83]).toEqual([66.7, 79.3, 92.6, 106.7, 128.3]);
    expect(BASE_LIFTS['Back Squat'][120]).toEqual([93.3, 116.4, 147.2, 180, 227.3]);
  });

  it('holds total load for bodyweight lifts, not added weight', () => {
    expect(BASE_LIFTS['Pull-Up'][83][2]).toBeGreaterThan(83);
    expect(BASE_LIFTS.Dip[83][2]).toBeGreaterThan(83);
    expect(BASE_LIFTS['Chin-Up'][83][2]).toBeGreaterThan(83);
  });
});

describe('RAISES', () => {
  it('raises shoulders, back and arms only', () => {
    const raises: Record<Group, number> = { Shoulders: 1.15, Back: 1.1, Arms: 1.1, Chest: 1, Legs: 1, Core: 1 };
    expect(RAISES).toEqual(raises);
  });
});

describe('level of a lift', () => {
  const only = (oneRepMaxKg: number, bodyweightKg: number, id = BENCH, muscle: Muscle = 'chest') =>
    muscleDetail(muscle, [{ exerciseId: id, oneRepMaxKg }], bodyweightKg)?.level;

  it('reads a named level straight from the table', () => {
    expect(only(66.7, 83)).toBe(0);
    expect(only(92.6, 83)).toBe(2);
    expect(only(128.3, 83)).toBe(4);
  });

  it('interpolates bodyweight before placing the 1RM', () => {
    // p50 is 82.3 kg at 74 and 92.6 kg at 83, so 87.45 kg at 78.5.
    expect(only(87.45, 78.5)).toBe(2);
  });

  it('interpolates between levels', () => {
    expect(only(99.65, 83)).toBe(2.5);
  });

  it('extrapolates past both ends', () => {
    expect(only(60.4, 83)).toBe(-0.5);
    expect(only(139.1, 83)).toBe(4.5);
  });

  it('clamps to a sane range', () => {
    expect(only(0, 83)).toBe(-1);
    expect(only(1000, 83)).toBe(5);
  });

  it('holds bodyweights outside the table at its ends', () => {
    expect(only(40.8, 40)).toBe(0);
    expect(only(162.7, 180)).toBe(4);
  });

  it('applies the raise, so the unraised value falls short', () => {
    const press = (oneRepMaxKg: number) => only(oneRepMaxKg, 83, 'gap_overhead_press', 'front-deltoids');
    expect(press(58.7 * 1.15)).toBe(2);
    expect(press(58.7)).toBeLessThan(2);
  });

  it("applies the row's ratio in logged terms", () => {
    // Per hand: 0.44 of an 83 kg lifter's 79.7 kg incline bench.
    expect(only(79.7 * 0.44, 83, 'Incline_Dumbbell_Press')).toBe(2);
  });

  it('places total load for bodyweight lifts', () => {
    expect(only(105 * 1.1, 83, 'Pullups', 'upper-back')).toBe(2);
  });
});

describe('muscleBalance', () => {
  describe.each(BODYWEIGHTS)('AC15 at %s kg', (bodyweightKg) => {
    it.each(LEVELS)('every muscle is yellow with every exercise at level %s', (level) => {
      const balance = muscleBalance(everyLiftAt(level, bodyweightKg), bodyweightKg);
      for (const [muscle, score] of Object.entries(balance)) {
        expect(score, muscle).toBe(0);
        expect(balanceColour(score), muscle).toBe(YELLOW);
      }
    });
  });

  it('AC16: leaves no muscle without data once every exercise is logged', () => {
    const empty = Object.entries(muscleBalance(everyLiftAt(2, 80), 80)).filter(([, score]) => score === null);
    expect(empty).toEqual([]);
  });

  it('AC16: counts any exercise for each of its muscles', () => {
    for (const { id, primaryMuscles, secondaryMuscles } of EXERCISES) {
      const balance = muscleBalance([lift(id, 2)], 80);
      const counted = [...primaryMuscles, ...secondaryMuscles];
      for (const [muscle, score] of Object.entries(balance)) {
        expect(score, `${id} ${muscle}`).toBe(counted.includes(muscle as Muscle) ? 0 : null);
      }
    }
  });

  it('AC21: the incline dumbbell press alone fills chest, front delts and triceps', () => {
    const balance = muscleBalance([lift('Incline_Dumbbell_Press', 1.3)], 80);
    const filled = Object.entries(balance).filter(([, score]) => score !== null);
    expect(filled.map(([muscle]) => muscle).sort()).toEqual(['chest', 'front-deltoids', 'triceps']);
    for (const [muscle, score] of filled) expect(balanceColour(score), muscle).toBe(YELLOW);
  });

  it('moves a lagging muscle smoothly towards red', () => {
    let previous = 0;
    let previousColour = channels(YELLOW);
    for (let delta = 0.1; delta <= 1; delta += 0.1) {
      const score = muscleBalance(shifted('Cable_Crunch', -delta), 80).abs as number;
      const colour = channels(balanceColour(score));
      expect(score).toBeLessThan(previous);
      expect(previous - score).toBeLessThan(0.15);
      expect(colour.green).toBeLessThan(previousColour.green);
      expect(colour.red).toBe(0xff);
      previous = score;
      previousColour = colour;
    }
  });

  it('moves a stronger muscle smoothly towards green', () => {
    let previous = 0;
    let previousColour = channels(YELLOW);
    for (let delta = 0.1; delta <= 1; delta += 0.1) {
      const score = muscleBalance(shifted('Cable_Crunch', delta), 80).abs as number;
      const colour = channels(balanceColour(score));
      expect(score).toBeGreaterThan(previous);
      expect(score - previous).toBeLessThan(0.15);
      expect(colour.red).toBeLessThan(previousColour.red);
      expect(colour.green).toBeLessThanOrEqual(previousColour.green);
      previous = score;
      previousColour = colour;
    }
  });

  it('pulls the other muscles slightly up when one lags', () => {
    const balance = muscleBalance(shifted('Cable_Crunch', -1), 80);
    expect(balance.chest).toBeGreaterThan(0);
    expect(balance.chest).toBeLessThan(0.1);
  });

  it('clamps the score to -1 and +1', () => {
    expect(muscleBalance(shifted('Cable_Crunch', -10), 80).abs).toBe(-1);
    expect(muscleBalance(shifted('Cable_Crunch', 50), 80).abs).toBe(1);
  });

  it('gives null and grey to muscles without data', () => {
    const balance = muscleBalance([lift(BENCH, 2)], 80);
    expect(balance.chest).toBe(0);
    expect(balance.quadriceps).toBeNull();
    expect(balanceColour(balance.quadriceps)).toBe('#3a3a3c');
  });

  it('gives every muscle null with no lifts', () => {
    const balance = muscleBalance([], 80);
    expect(Object.keys(balance)).toHaveLength(18);
    expect(Object.values(balance).every((score) => score === null)).toBe(true);
  });

  it('ignores a lift with no row, so an old custom exercise changes nothing', () => {
    const lifts = shifted('Cable_Crunch', -0.7);
    const extra = { exerciseId: 'custom_abc', oneRepMaxKg: 500 };
    expect(muscleBalance([...lifts, extra], 80)).toStrictEqual(muscleBalance(lifts, 80));
    expect(Object.values(muscleBalance([extra], 80)).every((score) => score === null)).toBe(true);
  });
});

describe('confidence', () => {
  it('scales high 1, medium 0.75, low 0.5', () => {
    expect(CONFIDENCE_WEIGHT).toEqual({ high: 1, medium: 0.75, low: 0.5 });
  });

  it('marks base lifts high', () => {
    expect(BASE_ROWS).toHaveLength(11);
    for (const id of BASE_ROWS) expect(row(id).confidence, id).toBe('high');
  });

  it('AC22: lets the higher-confidence lift move a muscle more', () => {
    // Both have biceps as their only primary muscle; only confidence differs.
    const medium = 'Barbell_Curl';
    const low = 'Machine_Bicep_Curl';
    expect(row(medium).confidence).toBe('medium');
    expect(row(low).confidence).toBe('low');

    const level = (lifts: LiftStrength[]) => muscleDetail('biceps', lifts, 80)?.level;
    // Weights 0.75 and 0.5: (0.75 * 3 + 0.5 * 1) / 1.25.
    expect(level([lift(medium, 3), lift(low, 1)])).toBeCloseTo(2.2, 8);
    expect(level([lift(medium, 1), lift(low, 3)])).toBeCloseTo(1.8, 8);
  });

  it('stacks on the primary and secondary weights', () => {
    // Triceps: pushdown, primary and medium, weighs 0.75. Bench, secondary and high, 0.5.
    const detail = muscleDetail('triceps', [lift(BENCH, 3), lift(PUSHDOWN, 1)], 80);
    expect(detail?.level).toBeCloseTo((0.5 * 3 + 0.75 * 1) / 1.25, 8);
  });
});

describe('muscleDetail', () => {
  const lifts: LiftStrength[] = [lift(BENCH, 3), lift(PUSHDOWN, 1), { exerciseId: 'custom_abc', oneRepMaxKg: 40 }];

  it('gives the numbers shown on a tapped muscle', () => {
    // Levels: chest 3, front-deltoids 3, triceps 1.8. Average 2.6.
    const detail = muscleDetail('triceps', lifts, 80);
    expect(detail?.levelName).toBe('Novice');
    expect(detail?.average).toBeCloseTo(2.6, 8);
    expect(detail?.score).toBeCloseTo(-0.8, 8);
    expect(detail?.lifts).toEqual([
      {
        exerciseId: BENCH,
        name: 'Barbell Bench Press - Medium Grip',
        oneRepMaxKg: lifts[0].oneRepMaxKg,
        level: 3,
        levelName: 'Advanced',
      },
      {
        exerciseId: PUSHDOWN,
        name: 'Triceps Pushdown',
        oneRepMaxKg: lifts[1].oneRepMaxKg,
        level: 1,
        levelName: 'Novice',
      },
    ]);
  });

  it('agrees with muscleBalance', () => {
    const balance = muscleBalance(lifts, 80);
    for (const muscle of ['chest', 'triceps', 'front-deltoids'] as Muscle[]) {
      expect(muscleDetail(muscle, lifts, 80)?.score, muscle).toBe(balance[muscle]);
    }
  });

  it('names levels outside the table for the nearest end', () => {
    const at = (oneRepMaxKg: number) =>
      muscleDetail('chest', [{ exerciseId: BENCH, oneRepMaxKg }], 83)?.levelName;
    expect(at(10)).toBe('Beginner');
    expect(at(66.7)).toBe('Beginner');
    expect(at(85)).toBe('Novice');
    expect(at(128.3)).toBe('Elite');
    expect(at(500)).toBe('Elite');
  });

  it('is null for a muscle without data', () => {
    expect(muscleDetail('calves', lifts, 80)).toBeNull();
  });
});

describe('balanceColour', () => {
  it.each([
    [-1, '#ff3b30'],
    [0, '#ffd60a'],
    [1, '#30d158'],
    [null, '#3a3a3c'],
  ])('gives %s exactly %s', (score, colour) => {
    expect(balanceColour(score)).toBe(colour);
  });

  it('clamps scores outside the range', () => {
    expect(balanceColour(-3)).toBe('#ff3b30');
    expect(balanceColour(3)).toBe('#30d158');
  });

  it('blends halfway between the end points', () => {
    expect(balanceColour(-0.5)).toBe('#ff891d');
    expect(balanceColour(0.5)).toBe('#98d431');
  });

  it('has no jump at zero', () => {
    const below = channels(balanceColour(-0.01));
    const above = channels(balanceColour(0.01));
    expect(Math.abs(below.red - above.red)).toBeLessThanOrEqual(3);
    expect(Math.abs(below.green - above.green)).toBeLessThanOrEqual(3);
  });
});
