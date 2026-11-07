import type { Bodyweight, Equipment, ISODate } from '../domain/types';

export const DEFAULT_BODYWEIGHT_KG = 80;

const MIN_LOAD_KG = 0.5;

/** How a logged weight becomes the load the curve sees. */
export interface Loading {
  equipment: Equipment;
  /** Two dumbbells or two cable handles, logged per hand. */
  perHand: boolean;
  /** Bodyweight rows: the share of bodyweight a rep moves. */
  bodyweightShare: number;
}

/** Latest live record on or before `date`, else the earliest, else the default. */
export function bodyweightOn(bodyweights: Bodyweight[], date: ISODate): number {
  const live = bodyweights
    .filter((record) => !record.deleted)
    .sort((a, b) => a.date.localeCompare(b.date));
  return live.findLast((record) => record.date <= date)?.kg ?? live[0]?.kg ?? DEFAULT_BODYWEIGHT_KG;
}

/** What the curve sees: both hands for per-hand rows, share × bodyweight + added for bodyweight rows. */
export function effectiveLoad(loading: Loading, weightKg: number, bodyweightKg: number): number {
  if (loading.equipment === 'bodyweight') return Math.max(loading.bodyweightShare * bodyweightKg + weightKg, MIN_LOAD_KG);
  return Math.max(loading.perHand ? 2 * weightKg : weightKg, MIN_LOAD_KG);
}

/** The inverse of `effectiveLoad`. */
export function loggedWeight(loading: Loading, load: number, bodyweightKg: number): number {
  if (loading.equipment === 'bodyweight') return load - loading.bodyweightShare * bodyweightKg;
  return loading.perHand ? load / 2 : load;
}

/** A logged weight must be above this, or it leaves no load at all. */
export function noLoadWeight(loading: Loading, bodyweightKg: number): number {
  return loading.equipment === 'bodyweight' ? -loading.bodyweightShare * bodyweightKg : 0;
}

/** The step of the grid real weights sit on, from zero. The log form steps by it too. */
export function gridStep(equipment: Equipment): number {
  return equipment === 'kettlebell' ? 4 : 2.5;
}

/**
 * The nearest real weight: a point on the grid from zero, or a weight already logged,
 * always above `floor`. Ties go to the lighter weight.
 */
export function roundToLoadable(kg: number, equipment: Equipment, realWeights: number[], floor = 0): number {
  const step = gridStep(equipment);
  const below = Math.floor(kg / step) * step;
  const lowestOnGrid = (Math.floor(floor / step) + 1) * step;
  const candidates = [below, below + step, lowestOnGrid, ...realWeights].filter((weight) => weight > floor);
  const best = candidates.reduce((nearest, weight) => {
    const [distance, nearestDistance] = [Math.abs(weight - kg), Math.abs(nearest - kg)];
    return distance < nearestDistance || (distance === nearestDistance && weight < nearest) ? weight : nearest;
  });
  return best + 0; // + 0 turns -0 into 0
}
