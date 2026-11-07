import { TARGET_REPS, colourForReps } from '../domain/colour';
import type { Colour, Entry, ISODate, Prediction } from '../domain/types';
import { e1rm, weightFor } from './curve';
import { type Fit, type ModelInput, fitSessions, liveEntries, sessionsOf, strengthAt } from './fit';
import {
  DEFAULT_BODYWEIGHT_KG,
  bodyweightOn,
  effectiveLoad,
  gridStep,
  loggedWeight,
  noLoadWeight,
  roundToLoadable,
} from './load';

export { DEFAULT_BODYWEIGHT_KG, bodyweightOn, e1rm, gridStep, roundToLoadable };
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

/** The next session, in the fit's units: 0 is the latest session. */
const NEXT = 1;

/**
 * Loads at each colour's target reps at session x, always in order. An offset can tip
 * the order, so a lighter colour never shows more than a heavier one.
 */
function loadsAt(fit: Fit, x: number): Prediction {
  const at = (colour: Colour) => weightFor(strengthAt(fit, x, colour), TARGET_REPS[colour]);
  const red = at('red');
  const yellow = Math.min(red, at('yellow'));
  const green = Math.min(yellow, at('green'));
  return { red, yellow, green };
}

function toLogged(input: ModelInput, loads: Prediction, bodyweightKg: number): Prediction {
  const logged = (colour: Colour) => loggedWeight(input, loads[colour], bodyweightKg);
  return { red: logged('red'), yellow: logged('yellow'), green: logged('green') };
}

function fitOn(input: ModelInput, date: ISODate): Fit | null {
  return fitSessions(sessionsOf(input, date));
}

/** Weight for each colour's target reps at the next session, before rounding, as logged. */
export function predictRaw(input: ModelInput, date: ISODate): Prediction | null {
  const fit = fitOn(input, date);
  return fit && toLogged(input, loadsAt(fit, NEXT), bodyweightOn(input.bodyweights, date));
}

/**
 * The nearest real weight for each colour's target reps at the next session, as logged.
 * The same however long ago the last session was. Null with no entries.
 */
export function predict(input: ModelInput, date: ISODate): Prediction | null {
  const raw = predictRaw(input, date);
  if (!raw) return null;
  const realWeights = [...liveEntries(input.entries, date).map(({ weightKg }) => weightKg), ...input.rackWeights];
  const floor = noLoadWeight(input, bodyweightOn(input.bodyweights, date));
  const round = (colour: Colour) => roundToLoadable(raw[colour], input.equipment, realWeights, floor);
  return { red: round('red'), yellow: round('yellow'), green: round('green') };
}

/**
 * The current fitted curve per colour: a point at each session, ending at `asOf` on the
 * next suggestion. Dots are entries normalised to their colour's target reps.
 */
export function strengthHistory(input: ModelInput, asOf: ISODate): StrengthHistory {
  const sessions = sessionsOf(input, asOf);
  const fit = fitSessions(sessions);
  const points: { date: ISODate; kg: Prediction }[] = [];
  if (fit) {
    sessions.forEach(({ date, bodyweightKg }, index) => {
      points.push({ date, kg: toLogged(input, loadsAt(fit, index - (sessions.length - 1)), bodyweightKg) });
    });
    if (points.at(-1)?.date === asOf) points.pop();
    points.push({ date: asOf, kg: toLogged(input, loadsAt(fit, NEXT), bodyweightOn(input.bodyweights, asOf)) });
  }
  const line = (colour: Colour) => points.map(({ date, kg }) => ({ date, kg: kg[colour] }));

  const dots = liveEntries(input.entries, asOf).map((entry) => {
    const bodyweightKg = bodyweightOn(input.bodyweights, entry.date);
    const colour = colourForReps(entry.reps);
    const load = effectiveLoad(input, entry.weightKg, bodyweightKg);
    const atTarget = weightFor(e1rm(load, entry.reps), TARGET_REPS[colour]);
    return { entryId: entry.id, date: entry.date, kg: loggedWeight(input, atTarget, bodyweightKg), colour };
  });

  return { lines: { red: line('red'), yellow: line('yellow'), green: line('green') }, dots };
}

/**
 * Estimated 1RM at the next session in logged terms, from the exercise's current colour:
 * one hand for per-hand rows, share × bodyweight + added for bodyweight rows. Null with
 * no entries.
 */
export function oneRepMax(input: ModelInput, date: ISODate): number | null {
  const fit = fitOn(input, date);
  if (!fit) return null;
  const colour = lastColour(liveEntries(input.entries, date));
  const load = e1rm(loadsAt(fit, NEXT)[colour], TARGET_REPS[colour]);
  return input.equipment !== 'bodyweight' && input.perHand ? load / 2 : load;
}

/** Colour of the last entry by date, ties by updatedAt. 'yellow' with no entries. */
export function lastColour(entries: Entry[]): Colour {
  const latest = liveEntries(entries, '9999-12-31').at(-1);
  return latest ? colourForReps(latest.reps) : 'yellow';
}
