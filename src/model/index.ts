import { TARGET_REPS, colourForReps } from '../domain/colour';
import type { Colour, Entry, ISODate, Prediction } from '../domain/types';
import { e1rm, weightFor } from './curve';
import {
  DEFAULT_BODYWEIGHT_KG,
  bodyweightOn,
  effectiveLoad,
  loggedWeight,
  roundToLoadable,
} from './load';
import { type ModelInput, type State, liveEntries, loadsOn, replay } from './replay';

export { DEFAULT_BODYWEIGHT_KG, e1rm, roundToLoadable };
export type { ModelInput };

export interface StrengthPoint {
  date: ISODate;
  kg: number;
}

export interface StrengthDot {
  entryId: string;
  date: ISODate;
  kg: number;
  colour: Colour;
}

export interface StrengthHistory {
  lines: Record<Colour, StrengthPoint[]>;
  dots: StrengthDot[];
}

function toLogged(input: ModelInput, loads: Prediction, bodyweightKg: number): Prediction {
  const logged = (colour: Colour) => loggedWeight(input.equipment, loads[colour], bodyweightKg);
  return { red: logged('red'), yellow: logged('yellow'), green: logged('green') };
}

function rawOn(input: ModelInput, state: State, date: ISODate): Prediction {
  return toLogged(input, loadsOn(state, date), bodyweightOn(input.bodyweights, date));
}

/** Weight for each colour's target reps on `date`, before rounding, as logged. */
export function predictRaw(input: ModelInput, date: ISODate): Prediction | null {
  const { state } = replay(input, date);
  return state && rawOn(input, state, date);
}

/** Loadable weight for each colour's target reps on `date`, as logged. Null with no entries. */
export function predict(input: ModelInput, date: ISODate): Prediction | null {
  const { state } = replay(input, date);
  if (!state) return null;
  const raw = rawOn(input, state, date);
  const bodyweightKg = bodyweightOn(input.bodyweights, date);
  const round = (colour: Colour) =>
    roundToLoadable(raw[colour], input.equipment, state.loggedWeights, bodyweightKg);
  return { red: round('red'), yellow: round('yellow'), green: round('green') };
}

/** One line per colour, a point per session plus a final decayed point at `asOf`. */
export function strengthHistory(input: ModelInput, asOf: ISODate): StrengthHistory {
  const { state, timeline } = replay(input, asOf);
  const points = timeline.map(({ date, loads, bodyweightKg }) => ({
    date,
    kg: toLogged(input, loads, bodyweightKg),
  }));
  if (state && state.date < asOf) points.push({ date: asOf, kg: rawOn(input, state, asOf) });
  const line = (colour: Colour) => points.map(({ date, kg }) => ({ date, kg: kg[colour] }));

  const dots = liveEntries(input.entries, asOf).map((entry) => {
    const bodyweightKg = bodyweightOn(input.bodyweights, entry.date);
    const colour = colourForReps(entry.reps);
    const load = effectiveLoad(input.equipment, entry.weightKg, bodyweightKg);
    const atTarget = weightFor(e1rm(load, entry.reps), TARGET_REPS[colour]);
    return {
      entryId: entry.id,
      date: entry.date,
      kg: loggedWeight(input.equipment, atTarget, bodyweightKg),
      colour,
    };
  });

  return { lines: { red: line('red'), yellow: line('yellow'), green: line('green') }, dots };
}

/**
 * Estimated 1RM in logged terms, from the exercise's current colour: per hand for
 * dumbbells, total load for bodyweight exercises. Null with no entries.
 */
export function oneRepMax(input: ModelInput, date: ISODate): number | null {
  const { state } = replay(input, date);
  if (!state) return null;
  const colour = lastColour(liveEntries(input.entries, date));
  const load = e1rm(loadsOn(state, date)[colour], TARGET_REPS[colour]);
  return input.equipment === 'dumbbell' ? load / 2 : load;
}

/** Colour of the last entry by date, ties by updatedAt. 'yellow' with no entries. */
export function lastColour(entries: Entry[]): Colour {
  const latest = liveEntries(entries, '9999-12-31').at(-1);
  return latest ? colourForReps(latest.reps) : 'yellow';
}
