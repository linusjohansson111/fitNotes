import { EXERCISES } from '../data';
import type { BaseLift, Confidence, ExerciseDef, Group, Muscle } from '../domain/types';
import table from './baseLifts.json';

/** Logged terms: per hand for dumbbells, total load for bodyweight exercises. */
export interface LiftStrength {
  exerciseId: string;
  oneRepMaxKg: number;
}

/** The numbers shown when a muscle is tapped. Levels run from Beginner 0 to Elite 4. */
export interface MuscleDetail {
  /** -1 lagging, 0 in proportion, +1 ahead. */
  score: number;
  level: number;
  levelName: string;
  /** Mean level across every muscle with data. */
  average: number;
  lifts: {
    exerciseId: string;
    name: string;
    oneRepMaxKg: number;
    level: number;
    levelName: string;
  }[];
}

/** Bodyweight class in kg to 1RM at each level. Men's gym percentiles from FitnessVolt. */
export const BASE_LIFTS = table.lifts as Record<BaseLift, Record<string, number[]>>;

/** One level per percentile in the table: p10, p25, p50, p75 and p95. */
export const LEVEL_NAMES = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'] as const;

/**
 * Judgement, not data: no published bodybuilder table was found. Raises what counts as
 * in proportion for an exercise's group, so edit it to change the balance you aim for.
 */
export const RAISES: Record<Group, number> = {
  Chest: 1,
  Back: 1.1,
  Shoulders: 1.15,
  Arms: 1.1,
  Legs: 1,
  Core: 1,
};

/** A guess must not outvote a measured lift. */
export const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 1, medium: 0.75, low: 0.5 };

const PRIMARY_WEIGHT = 1;
const SECONDARY_WEIGHT = 0.5;

const MUSCLES: Muscle[] = [
  'trapezius',
  'upper-back',
  'lower-back',
  'chest',
  'biceps',
  'triceps',
  'forearm',
  'back-deltoids',
  'front-deltoids',
  'abs',
  'obliques',
  'adductor',
  'hamstring',
  'quadriceps',
  'abductors',
  'calves',
  'gluteal',
  'neck',
];

const MIN_LEVEL = -1;
const MAX_LEVEL = 5;

const RED = [0xff, 0x3b, 0x30];
const YELLOW = [0xff, 0xd6, 0x0a];
const GREEN = [0x30, 0xd1, 0x58];
const GREY = '#3a3a3c';

const ROW_BY_ID = new Map(EXERCISES.map((row) => [row.id, row]));

interface Contribution {
  lift: LiftStrength;
  row: ExerciseDef;
  level: number;
  weight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds off float noise, so lifts at one level score exactly 0 and not 1e-16. */
function tidy(value: number): number {
  return Math.round(value * 1e9) / 1e9 + 0; // + 0 turns -0 into 0
}

/** The base lift's levels at a bodyweight, held at the table's ends beyond them. */
function baseLevels(baseLift: BaseLift, bodyweightKg: number): number[] {
  const classes = BASE_LIFTS[baseLift];
  const bodyweights = Object.keys(classes).map(Number);
  const kg = clamp(bodyweightKg, bodyweights[0], bodyweights[bodyweights.length - 1]);
  const upper = Math.max(1, bodyweights.findIndex((bodyweight) => bodyweight >= kg));
  const below = bodyweights[upper - 1];
  const above = bodyweights[upper];
  const share = (kg - below) / (above - below);
  return classes[below].map((low, level) => low + (classes[above][level] - low) * share);
}

function levelOf(row: ExerciseDef, oneRepMaxKg: number, bodyweightKg: number): number {
  const kg = baseLevels(row.baseLift, bodyweightKg).map(
    (value) => value * row.ratio * RAISES[row.group],
  );
  const above = kg.findIndex((value, level) => level > 0 && oneRepMaxKg <= value);
  // Past either end, the nearest step between levels carries on.
  const below = above === -1 ? kg.length - 2 : above - 1;
  const level = below + (oneRepMaxKg - kg[below]) / (kg[below + 1] - kg[below]);
  return tidy(clamp(level, MIN_LEVEL, MAX_LEVEL));
}

/** Entries with no row, such as an old custom exercise, leave the map alone. */
function contributionsByMuscle(
  lifts: LiftStrength[],
  bodyweightKg: number,
): Map<Muscle, Contribution[]> {
  const byMuscle = new Map<Muscle, Contribution[]>();
  const add = (muscle: Muscle, contribution: Contribution) =>
    byMuscle.set(muscle, [...(byMuscle.get(muscle) ?? []), contribution]);

  for (const lift of lifts) {
    const row = ROW_BY_ID.get(lift.exerciseId);
    if (!row) continue;
    const level = levelOf(row, lift.oneRepMaxKg, bodyweightKg);
    const confidence = CONFIDENCE_WEIGHT[row.confidence];
    for (const muscle of row.primaryMuscles) {
      add(muscle, { lift, row, level, weight: PRIMARY_WEIGHT * confidence });
    }
    for (const muscle of row.secondaryMuscles) {
      add(muscle, { lift, row, level, weight: SECONDARY_WEIGHT * confidence });
    }
  }
  return byMuscle;
}

function muscleLevel(contributions: Contribution[]): number {
  const total = contributions.reduce((sum, { weight }) => sum + weight, 0);
  const weighted = contributions.reduce((sum, { level, weight }) => sum + level * weight, 0);
  return tidy(weighted / total);
}

function averageLevel(byMuscle: Map<Muscle, Contribution[]>): number {
  const levels = [...byMuscle.values()].map(muscleLevel);
  return tidy(levels.reduce((sum, level) => sum + level, 0) / levels.length);
}

function scoreOf(level: number, average: number): number {
  return tidy(clamp(level - average, -1, 1));
}

/** The level reached, so 1.6 reads as Novice on the way to Intermediate. */
function levelName(level: number): string {
  return LEVEL_NAMES[clamp(Math.floor(level), 0, LEVEL_NAMES.length - 1)];
}

export function muscleBalance(
  lifts: LiftStrength[],
  bodyweightKg: number,
): Record<Muscle, number | null> {
  const byMuscle = contributionsByMuscle(lifts, bodyweightKg);
  const average = averageLevel(byMuscle);
  const entries = MUSCLES.map((muscle) => {
    const contributions = byMuscle.get(muscle);
    return [muscle, contributions ? scoreOf(muscleLevel(contributions), average) : null];
  });
  return Object.fromEntries(entries) as Record<Muscle, number | null>;
}

export function muscleDetail(
  muscle: Muscle,
  lifts: LiftStrength[],
  bodyweightKg: number,
): MuscleDetail | null {
  const byMuscle = contributionsByMuscle(lifts, bodyweightKg);
  const contributions = byMuscle.get(muscle);
  if (!contributions) return null;
  const level = muscleLevel(contributions);
  const average = averageLevel(byMuscle);
  return {
    score: scoreOf(level, average),
    level,
    levelName: levelName(level),
    average,
    lifts: contributions.map(({ lift, row, level: liftLevel }) => ({
      exerciseId: lift.exerciseId,
      name: row.name,
      oneRepMaxKg: lift.oneRepMaxKg,
      level: liftLevel,
      levelName: levelName(liftLevel),
    })),
  };
}

/** Continuous from red at -1 through yellow at 0 to green at +1; grey without data. */
export function balanceColour(score: number | null): string {
  if (score === null) return GREY;
  const clamped = clamp(score, -1, 1);
  const end = clamped < 0 ? RED : GREEN;
  const channels = YELLOW.map((channel, index) => {
    const value = Math.round(channel + (end[index] - channel) * Math.abs(clamped));
    return value.toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}
