import type { Muscle } from '../domain/types';
import { LEVEL_NAMES, STANDARDS, type LiftStandard } from './standards';

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

const STANDARD_BY_EXERCISE = new Map(
  STANDARDS.flatMap((standard) => standard.exerciseIds.map((id) => [id, standard] as const)),
);

interface Contribution {
  lift: LiftStrength;
  standard: LiftStandard;
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

function raisedStandards(standard: LiftStandard, bodyweightKg: number): number[] {
  const bodyweights = Object.keys(standard.standards).map(Number);
  const kg = clamp(bodyweightKg, bodyweights[0], bodyweights[bodyweights.length - 1]);
  const upper = Math.max(1, bodyweights.findIndex((bodyweight) => bodyweight >= kg));
  const below = bodyweights[upper - 1];
  const above = bodyweights[upper];
  const share = (kg - below) / (above - below);
  return standard.standards[below].map((low, level) => {
    const high = standard.standards[above][level];
    return standard.raise * (low + (high - low) * share);
  });
}

function levelOf(standard: LiftStandard, oneRepMaxKg: number, bodyweightKg: number): number {
  const kg = raisedStandards(standard, bodyweightKg);
  const above = kg.findIndex((value, level) => level > 0 && oneRepMaxKg <= value);
  // Past either end, the nearest step between levels carries on.
  const below = above === -1 ? kg.length - 2 : above - 1;
  const level = below + (oneRepMaxKg - kg[below]) / (kg[below + 1] - kg[below]);
  return tidy(clamp(level, MIN_LEVEL, MAX_LEVEL));
}

/** Lifts outside the table are ignored, so custom exercises leave the map unchanged. */
function contributionsByMuscle(
  lifts: LiftStrength[],
  bodyweightKg: number,
): Map<Muscle, Contribution[]> {
  const byMuscle = new Map<Muscle, Contribution[]>();
  for (const lift of lifts) {
    const standard = STANDARD_BY_EXERCISE.get(lift.exerciseId);
    if (!standard) continue;
    const level = levelOf(standard, lift.oneRepMaxKg, bodyweightKg);
    for (const [muscle, weight] of Object.entries(standard.muscles) as [Muscle, number][]) {
      const contribution = { lift, standard, level, weight };
      byMuscle.set(muscle, [...(byMuscle.get(muscle) ?? []), contribution]);
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
    lifts: contributions.map(({ lift, standard, level: liftLevel }) => ({
      exerciseId: lift.exerciseId,
      name: standard.name,
      oneRepMaxKg: lift.oneRepMaxKg,
      level: liftLevel,
      levelName: levelName(liftLevel),
    })),
  };
}

export function isCounted(exerciseId: string): boolean {
  return STANDARD_BY_EXERCISE.has(exerciseId);
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
