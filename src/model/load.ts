import type { Bodyweight, Equipment, ISODate } from '../domain/types';

export const DEFAULT_BODYWEIGHT_KG = 80;

const MIN_LOAD_KG = 0.5;

const DEFAULT_STEP_KG: Record<Equipment, number> = {
  barbell: 2.5,
  dumbbell: 2,
  machine: 2.5,
  cable: 2.5,
  kettlebell: 4,
  bodyweight: 2.5,
  other: 2.5,
};

/** Latest live record on or before `date`, else the earliest, else the default. */
export function bodyweightOn(bodyweights: Bodyweight[], date: ISODate): number {
  const live = bodyweights
    .filter((record) => !record.deleted)
    .sort((a, b) => a.date.localeCompare(b.date));
  return live.findLast((record) => record.date <= date)?.kg ?? live[0]?.kg ?? DEFAULT_BODYWEIGHT_KG;
}

/** What the curve sees. Dumbbells count both hands because it is unrealistic at low loads. */
export function effectiveLoad(equipment: Equipment, weightKg: number, bodyweightKg: number): number {
  if (equipment === 'dumbbell') return Math.max(2 * weightKg, MIN_LOAD_KG);
  if (equipment === 'bodyweight') return Math.max(bodyweightKg + weightKg, MIN_LOAD_KG);
  return Math.max(weightKg, MIN_LOAD_KG);
}

/** The inverse of `effectiveLoad`. */
export function loggedWeight(equipment: Equipment, load: number, bodyweightKg: number): number {
  if (equipment === 'dumbbell') return load / 2;
  if (equipment === 'bodyweight') return load - bodyweightKg;
  return load;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** GCD of logged differences on a 0.25 kg grid, once 3 distinct weights exist. */
export function loadableStep(equipment: Equipment, loggedWeights: number[]): number {
  const quarters = [...new Set(loggedWeights.map((weight) => Math.round(weight * 4)))];
  if (quarters.length < 3) return DEFAULT_STEP_KG[equipment];
  return quarters.reduce((step, quarter) => gcd(step, Math.abs(quarter - quarters[0])), 0) / 4;
}

/**
 * Nearest loadable weight. Snaps relative to the latest of `loggedWeights`, so offset
 * stacks like 7.5/12.5/17.5 work. Never returns a weight that would leave no load:
 * zero or less, or assistance that reaches bodyweight.
 */
export function roundToLoadable(
  kg: number,
  equipment: Equipment,
  loggedWeights: number[],
  bodyweightKg: number = DEFAULT_BODYWEIGHT_KG,
): number {
  const step = loadableStep(equipment, loggedWeights);
  const anchor = loggedWeights.at(-1) ?? 0;
  const rounded = anchor + Math.round((kg - anchor) / step) * step;
  const noLoadAt = equipment === 'bodyweight' ? -bodyweightKg : 0;
  const lowest = anchor + (Math.floor((noLoadAt - anchor) / step) + 1) * step;
  return Math.max(rounded, lowest);
}
