import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../data';
import type { ExerciseDef, Group, Muscle } from '../domain/types';
import type { BaseLift } from '../domain/types';
import {
  BASE_LIFTS,
  BASE_ROWS,
  CONFIDENCE_WEIGHT,
  LEVEL_NAMES,
  MECHANIC_WEIGHT,
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

/** A base lift's kg at each level for a bodyweight, interpolated between classes. */
function measured(baseLift: BaseLift, bodyweightKg: number): number[] {
  const classes = BASE_LIFTS[baseLift];
  const bodyweights = Object.keys(classes).map(Number);
  const kg = Math.min(Math.max(bodyweightKg, bodyweights[0]), bodyweights[bodyweights.length - 1]);
  const below = Math.max(...bodyweights.filter((bodyweight) => bodyweight <= kg));
  const above = Math.min(...bodyweights.filter((bodyweight) => bodyweight >= kg));
  const share = above === below ? 0 : (kg - below) / (above - below);
  return classes[below].map((low, level) => low + (classes[above][level] - low) * share);
}

const WEIGHTED: BaseLift[] = ['Back Squat', 'Bench Press', 'Deadlift', 'Front Squat', 'Sumo Deadlift', 'Incline Bench Press', 'Overhead Press', 'Pendlay Row'];
const BODYWEIGHT: BaseLift[] = ['Dip', 'Chin-Up', 'Pull-Up'];

/**
 * A row's raised kg at a level, worked out independently of the code under test: measured
 * levels for a base row, else its median times the mean multiples of its kind of base lift.
 */
function tableKg(exercise: ExerciseDef, bodyweightKg: number, level: number): number {
  const raise = exercise.ratio * RAISES[exercise.group];
  let levels: number[];
  if (BASE_ROWS[exercise.baseLift] === exercise.id) {
    levels = measured(exercise.baseLift, bodyweightKg).map((kg) => kg * raise);
  } else {
    const lifts = exercise.equipment === 'bodyweight' ? BODYWEIGHT : WEIGHTED;
    const median = measured(exercise.baseLift, bodyweightKg)[2] * raise;
    levels = [0, 1, 2, 3, 4].map(
      (index) =>
        median *
        (lifts.reduce((sum, lift) => {
          const own = measured(lift, bodyweightKg);
          return sum + own[index] / own[2];
        }, 0) /
          lifts.length),
    );
  }
  const lower = Math.min(3, Math.max(0, Math.floor(level)));
  return levels[lower] + (levels[lower + 1] - levels[lower]) * (level - lower);
}

const lift = (id: string, level: number, bodyweightKg = 80): LiftStrength => ({
  exerciseId: id,
  oneRepMaxKg: tableKg(row(id), bodyweightKg, level),
});

/** Every exercise in the bank at one level. */
const everyLiftAt = (level: number, bodyweightKg: number): LiftStrength[] =>
  EXERCISES.map(({ id }) => lift(id, level, bodyweightKg));

const BASE_IDS = Object.values(BASE_ROWS);

/** The base lifts at level 2, and one more lift off them by `delta`. */
const shifted = (id: string, delta: number): LiftStrength[] => [
  ...BASE_IDS.map((baseRow) => lift(baseRow, 2)),
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
    expect(BASE_IDS).toHaveLength(11);
    for (const [baseLift, id] of Object.entries(BASE_ROWS)) {
      expect(row(id), id).toMatchObject({ baseLift, ratio: 1, confidence: 'high', mechanic: 'compound' });
    }
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

  it('stacks on the role and type weights', () => {
    // Triceps: pushdown, primary, medium and isolation, weighs 0.375. Bench, secondary, high and compound, 0.5.
    const detail = muscleDetail('triceps', [lift(BENCH, 3), lift(PUSHDOWN, 1)], 80);
    expect(detail?.level).toBeCloseTo((0.5 * 3 + 0.375 * 1) / 0.875, 8);
  });
});

describe('mechanic', () => {
  it('weighs compound 1 and isolation 0.5', () => {
    expect(MECHANIC_WEIGHT).toEqual({ compound: 1, isolation: 0.5 });
  });

  it('AC34: places a muscle twice as close to the compound lift as to the isolation lift', () => {
    const compound = 'Close-Grip_Barbell_Bench_Press';
    const isolation = 'EZ-Bar_Skullcrusher';
    for (const id of [compound, isolation]) {
      expect(row(id).primaryMuscles, id).toContain('triceps');
      expect(row(id).confidence, id).toBe('medium');
    }
    expect([row(compound).mechanic, row(isolation).mechanic]).toEqual(['compound', 'isolation']);

    const level = muscleDetail('triceps', [lift(compound, 3), lift(isolation, 0)], 80)?.level as number;
    expect(level - 0).toBeCloseTo(2 * (3 - level), 8);
  });
});

describe('levels', () => {
  const only = (id: string, oneRepMaxKg: number, bodyweightKg = 80) =>
    muscleDetail(row(id).primaryMuscles[0], [{ exerciseId: id, oneRepMaxKg }], bodyweightKg)?.level;

  it('keeps the measured levels of a base lift', () => {
    expect(only(BENCH, 66.7, 83)).toBe(0);
    expect(only(BENCH, 128.3, 83)).toBe(4);
  });

  it('AC33: gives derived weighted rows on different base lifts the same level at the same multiple of their median', () => {
    const rows = ['Incline_Dumbbell_Press', 'Barbell_Curl', 'Leg_Extensions', 'Seated_Cable_Rows', 'Dumbbell_Shoulder_Press'];
    expect(new Set(rows.map((id) => row(id).baseLift)).size).toBe(rows.length);
    for (const multiple of [0.6, 0.85, 1, 1.2, 1.6]) {
      const levels = rows.map((id) => only(id, tableKg(row(id), 80, 2) * multiple));
      for (const level of levels) expect(level).toBeCloseTo(levels[0] as number, 9);
    }
  });

  it('spreads derived bodyweight rows like the bodyweight base lifts, narrower than weighted rows', () => {
    const range = (id: string) => tableKg(row(id), 80, 4) / tableKg(row(id), 80, 0);
    expect(row('Pushups').equipment).toBe('bodyweight');
    expect(range('Pushups')).toBeCloseTo(range('Hanging_Leg_Raise'), 9);
    expect(range('Pushups')).toBeLessThan(range('Barbell_Curl'));
    expect(range('Barbell_Curl')).toBeGreaterThan(1.8);
  });

  it('gives a curl the weighted spread, though its base lift is a bodyweight lift', () => {
    expect(row('Barbell_Curl').baseLift).toBe('Chin-Up');
    expect(tableKg(row('Barbell_Curl'), 80, 4) / tableKg(row('Barbell_Curl'), 80, 0)).toBeCloseTo(
      tableKg(row('Incline_Dumbbell_Press'), 80, 4) / tableKg(row('Incline_Dumbbell_Press'), 80, 0),
      9,
    );
  });
});

describe('muscleDetail', () => {
  const lifts: LiftStrength[] = [lift(BENCH, 3), lift(PUSHDOWN, 1), { exerciseId: 'custom_abc', oneRepMaxKg: 40 }];

  it('gives the numbers shown on a tapped muscle', () => {
    // Levels: chest 3, front-deltoids 3, triceps (0.5 * 3 + 0.375 * 1) / 0.875 = 15/7. Average 51/21.
    const detail = muscleDetail('triceps', lifts, 80);
    expect(detail?.level).toBeCloseTo(15 / 7, 8);
    expect(detail?.levelName).toBe('Intermediate');
    expect(detail?.average).toBeCloseTo((3 + 3 + 15 / 7) / 3, 8);
    expect(detail?.score).toBeCloseTo(15 / 7 - (3 + 3 + 15 / 7) / 3, 8);
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
