import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../data';
import type { ExerciseDef, Group, Muscle } from '../domain/types';
import {
  balanceColour,
  isCounted,
  muscleBalance,
  muscleDetail,
  type LiftStrength,
} from './index';
import { STANDARDS, type LiftStandard } from './standards';

const BODYWEIGHTS = [60, 72.5, 80, 83.4, 100, 120];
const LEVELS = [-0.5, 0, 0.25, 0.5, 1, 1.4, 2, 2.75, 3, 3.5, 4, 4.5];
const UNCOVERED: Muscle[] = ['obliques', 'neck'];
const YELLOW = '#ffd60a';

const bank = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

function lift(name: string): LiftStandard {
  const found = STANDARDS.find((standard) => standard.name === name);
  if (!found) throw new Error(`No standard called ${name}`);
  return found;
}

/**
 * The raised table's value, worked out level-first: the code under test goes
 * bodyweight-first, and both must meet at the same number.
 */
function tableKg(standard: LiftStandard, bodyweightKg: number, level: number): number {
  const bodyweights = Object.keys(standard.standards).map(Number);
  const below = Math.max(...bodyweights.filter((bodyweight) => bodyweight <= bodyweightKg));
  const above = Math.min(...bodyweights.filter((bodyweight) => bodyweight >= bodyweightKg));
  const lower = Math.min(3, Math.max(0, Math.floor(level)));
  const atLevel = (kg: number[]): number => kg[lower] + (kg[lower + 1] - kg[lower]) * (level - lower);
  const low = atLevel(standard.standards[below]);
  const high = atLevel(standard.standards[above]);
  const share = above === below ? 0 : (bodyweightKg - below) / (above - below);
  return standard.raise * (low + (high - low) * share);
}

/** One lift per table row, or every exercise of every row. */
function liftsAt(level: number, bodyweightKg: number, everyExercise = false): LiftStrength[] {
  return STANDARDS.flatMap((standard) =>
    (everyExercise ? standard.exerciseIds : standard.exerciseIds.slice(0, 1)).map((exerciseId) => ({
      exerciseId,
      oneRepMaxKg: tableKg(standard, bodyweightKg, level),
    })),
  );
}

/** Red and green channels of a #rrggbb colour. */
function channels(colour: string): { red: number; green: number } {
  return {
    red: Number.parseInt(colour.slice(1, 3), 16),
    green: Number.parseInt(colour.slice(3, 5), 16),
  };
}

describe('standards table', () => {
  const rows = STANDARDS.flatMap((standard) =>
    Object.entries(standard.standards).map(([bodyweight, kg]) => ({
      name: standard.name,
      bodyweight,
      kg,
    })),
  );

  it('rises with level', () => {
    for (const { name, bodyweight, kg } of rows) {
      for (let level = 1; level < kg.length; level += 1) {
        expect(kg[level], `${name} at ${bodyweight}`).toBeGreaterThan(kg[level - 1]);
      }
    }
  });

  it('rises with bodyweight', () => {
    for (const { name, standards } of STANDARDS) {
      const bodyweights = Object.keys(standards).map(Number);
      for (let index = 1; index < bodyweights.length; index += 1) {
        const lighter = standards[bodyweights[index - 1]];
        standards[bodyweights[index]].forEach((kg, level) => {
          expect(kg, `${name} at ${bodyweights[index]}`).toBeGreaterThanOrEqual(lighter[level]);
        });
      }
    }
  });

  it('counts only bank exercises, each for one lift', () => {
    const ids = STANDARDS.flatMap((standard) => standard.exerciseIds);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(bank.has(id), id).toBe(true);
  });

  it('takes muscles from the bank: primary 1, secondary 0.5', () => {
    for (const { name, exerciseIds, muscles } of STANDARDS) {
      const { primaryMuscles, secondaryMuscles } = bank.get(exerciseIds[0]) as ExerciseDef;
      const expected = {
        ...Object.fromEntries(secondaryMuscles.map((muscle) => [muscle, 0.5])),
        ...Object.fromEntries(primaryMuscles.map((muscle) => [muscle, 1])),
      };
      expect(muscles, name).toEqual(expected);
    }
  });

  it('raises shoulders, back and arms only', () => {
    const raises: Record<Group, number> = {
      Shoulders: 1.15,
      Back: 1.1,
      Arms: 1.1,
      Chest: 1,
      Legs: 1,
      Core: 1,
    };
    for (const { name, exerciseIds, raise } of STANDARDS) {
      expect(raise, name).toBe(raises[(bank.get(exerciseIds[0]) as ExerciseDef).group]);
    }
  });

  it('holds total load for bodyweight lifts, not reps or added weight', () => {
    // The site gives -5, +7, +22, +39 and +56 kg at 50 kg bodyweight.
    expect(lift('Pull-Up').standards[50]).toEqual([45, 57, 72, 89, 106]);
    expect(lift('Dip').standards[50]).toEqual([45, 61, 81, 104, 128]);
    expect(lift('Chin-Up').standards[50]).toEqual([46, 58, 73, 89, 106]);
  });

  it('holds the male table', () => {
    expect(lift('Bench Press').standards[50]).toEqual([27, 41, 58, 78, 101]);
    expect(lift('Bench Press').standards[140]).toEqual([104, 129, 158, 191, 225]);
  });
});

describe('level of a lift', () => {
  const only = (oneRepMaxKg: number, bodyweightKg: number): number | undefined =>
    muscleDetail(
      'chest',
      [{ exerciseId: 'Barbell_Bench_Press_-_Medium_Grip', oneRepMaxKg }],
      bodyweightKg,
    )?.level;

  it('reads a named level straight from the table', () => {
    expect(only(56, 80)).toBe(0);
    expect(only(98, 80)).toBe(2);
    expect(only(151, 80)).toBe(4);
  });

  it('interpolates bodyweight before placing the 1RM', () => {
    // Intermediate is 98 kg at 80 and 104 kg at 85, so 101 kg at 82.5.
    expect(only(101, 82.5)).toBe(2);
  });

  it('interpolates between levels', () => {
    expect(only(111, 80)).toBe(2.5);
  });

  it('extrapolates past both ends', () => {
    expect(only(46.5, 80)).toBe(-0.5);
    expect(only(164.5, 80)).toBe(4.5);
  });

  it('clamps to a sane range', () => {
    expect(only(0, 80)).toBe(-1);
    expect(only(1000, 80)).toBe(5);
  });

  it('holds bodyweights outside the table at its ends', () => {
    expect(only(27, 40)).toBe(0);
    expect(only(225, 180)).toBe(4);
  });

  it('applies the raise, so the unraised standard falls short', () => {
    const press = lift('Shoulder Press');
    const detail = (oneRepMaxKg: number) =>
      muscleDetail('front-deltoids', [{ exerciseId: 'gap_overhead_press', oneRepMaxKg }], 80)?.level;
    const intermediate = press.standards[80][2];
    expect(detail(intermediate * 1.15)).toBe(2);
    expect(detail(intermediate)).toBeLessThan(2);
  });

  it('places total load for bodyweight lifts', () => {
    // 80 kg lifter, Pull-Up Intermediate is the table value times 1.10.
    const raised = lift('Pull-Up').standards[80][2] * 1.1;
    const detail = muscleDetail('upper-back', [{ exerciseId: 'Pullups', oneRepMaxKg: raised }], 80);
    expect(detail?.level).toBe(2);
  });
});

describe('muscleBalance', () => {
  describe.each(BODYWEIGHTS)('AC15 at %s kg', (bodyweightKg) => {
    it.each(LEVELS)('every muscle with data is yellow at level %s', (level) => {
      for (const everyExercise of [false, true]) {
        const balance = muscleBalance(liftsAt(level, bodyweightKg, everyExercise), bodyweightKg);
        for (const [muscle, score] of Object.entries(balance)) {
          if (UNCOVERED.includes(muscle as Muscle)) continue;
          expect(score, muscle).toBe(0);
          expect(balanceColour(score), muscle).toBe(YELLOW);
        }
      }
    });
  });

  it('has data for all but the uncovered muscles when every lift is logged', () => {
    const balance = muscleBalance(liftsAt(2, 80), 80);
    const empty = Object.entries(balance).filter(([, score]) => score === null);
    expect(empty.map(([muscle]) => muscle).sort()).toEqual([...UNCOVERED].sort());
  });

  it('gives a muscle with data one of its lifts level, when only one lift exists', () => {
    expect(muscleBalance(liftsAt(2, 80).slice(0, 1), 80).chest).toBe(0);
  });

  const shifted = (name: string, delta: number, bodyweightKg = 80): LiftStrength[] =>
    STANDARDS.map((standard) => ({
      exerciseId: standard.exerciseIds[0],
      oneRepMaxKg: tableKg(standard, bodyweightKg, standard.name === name ? 2 + delta : 2),
    }));

  it('moves a lagging muscle smoothly towards red', () => {
    let previous = 0;
    let previousColour = channels(YELLOW);
    for (let delta = 0.1; delta <= 1; delta += 0.1) {
      const score = muscleBalance(shifted('Cable Crunch', -delta), 80).abs as number;
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
      const score = muscleBalance(shifted('Cable Crunch', delta), 80).abs as number;
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
    const balance = muscleBalance(shifted('Cable Crunch', -1), 80);
    expect(balance.calves).toBeGreaterThan(0);
    expect(balance.calves).toBeLessThan(0.1);
  });

  it('clamps the score to -1 and +1', () => {
    expect(muscleBalance(shifted('Cable Crunch', -10), 80).abs).toBe(-1);
    expect(muscleBalance(shifted('Cable Crunch', 50), 80).abs).toBe(1);
  });

  it('gives null and grey to muscles without data', () => {
    const balance = muscleBalance(
      [{ exerciseId: 'Barbell_Bench_Press_-_Medium_Grip', oneRepMaxKg: 100 }],
      80,
    );
    expect(balance.chest).toBe(0);
    expect(balance.quadriceps).toBeNull();
    expect(balanceColour(balance.quadriceps)).toBe('#3a3a3c');
    for (const muscle of UNCOVERED) expect(balance[muscle]).toBeNull();
  });

  it('gives every muscle null with no lifts', () => {
    const balance = muscleBalance([], 80);
    expect(Object.keys(balance)).toHaveLength(18);
    expect(Object.values(balance).every((score) => score === null)).toBe(true);
  });

  it('leaves the result strictly equal when a lift is not in the table (AC16)', () => {
    const lifts = shifted('Cable Crunch', -0.7);
    const before = muscleBalance(lifts, 80);
    for (const exerciseId of ['custom_abc', 'Zottman_Curl', 'Butterfly']) {
      expect(isCounted(exerciseId), exerciseId).toBe(false);
      const extra = { exerciseId, oneRepMaxKg: 500 };
      expect(muscleBalance([...lifts, extra], 80)).toStrictEqual(before);
      expect(muscleBalance([extra, ...lifts], 80)).toStrictEqual(before);
    }
  });

  it('leaves the map all grey when only custom lifts exist', () => {
    const balance = muscleBalance([{ exerciseId: 'custom_abc', oneRepMaxKg: 100 }], 80);
    expect(Object.values(balance).every((score) => score === null)).toBe(true);
  });
});

describe('muscleDetail', () => {
  const bench = 'Barbell_Bench_Press_-_Medium_Grip';
  const pushdown = 'Triceps_Pushdown';
  const lifts: LiftStrength[] = [
    { exerciseId: bench, oneRepMaxKg: tableKg(lift('Bench Press'), 80, 3) },
    { exerciseId: pushdown, oneRepMaxKg: tableKg(lift('Tricep Pushdown'), 80, 1) },
    { exerciseId: 'custom_abc', oneRepMaxKg: 40 },
  ];

  it('weighs primary lifts twice as much as secondary ones', () => {
    // Triceps: pushdown level 1 at weight 1, bench level 3 at weight 0.5.
    expect(muscleDetail('triceps', lifts, 80)?.level).toBeCloseTo(5 / 3, 8);
  });

  it('gives the numbers shown on a tapped muscle', () => {
    // Levels: chest 3, front-deltoids 3, triceps 5/3. Average 23/9.
    const detail = muscleDetail('triceps', lifts, 80);
    expect(detail?.levelName).toBe('Novice');
    expect(detail?.average).toBeCloseTo(23 / 9, 8);
    expect(detail?.score).toBeCloseTo(5 / 3 - 23 / 9, 8);
    expect(detail?.lifts).toEqual([
      {
        exerciseId: bench,
        name: 'Bench Press',
        oneRepMaxKg: tableKg(lift('Bench Press'), 80, 3),
        level: 3,
        levelName: 'Advanced',
      },
      {
        exerciseId: pushdown,
        name: 'Tricep Pushdown',
        oneRepMaxKg: tableKg(lift('Tricep Pushdown'), 80, 1),
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
      muscleDetail('chest', [{ exerciseId: bench, oneRepMaxKg }], 80)?.levelName;
    expect(at(10)).toBe('Beginner');
    expect(at(56)).toBe('Beginner');
    expect(at(75)).toBe('Novice');
    expect(at(151)).toBe('Elite');
    expect(at(500)).toBe('Elite');
  });

  it('is null for a muscle without data', () => {
    expect(muscleDetail('calves', lifts, 80)).toBeNull();
  });
});

describe('isCounted', () => {
  it('is true for table exercises and false for the rest', () => {
    expect(isCounted('Barbell_Squat')).toBe(true);
    expect(isCounted('gap_overhead_press')).toBe(true);
    expect(isCounted('gap_assisted_pull_up_machine')).toBe(true);
    expect(isCounted('Band_Assisted_Pull-Up')).toBe(false);
    expect(isCounted('custom_abc')).toBe(false);
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
