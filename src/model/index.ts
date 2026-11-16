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

/** An entry at its 8-rep equivalent, coloured by the reps it reached. */
export interface StrengthDot {
  entryId: string;
  date: ISODate;
  kg: number;
  colour: Colour;
}

export interface StrengthHistory {
  line: StrengthPoint[];
  dots: StrengthDot[];
}

/** The next session, in the fit's units: 0 is the latest session. */
const NEXT = 1;

/** The load for 8 reps at session x. */
function loadAt(fit: Fit, x: number): number {
  return weightFor(strengthAt(fit, x), TARGET_REPS);
}

function fitOn(input: ModelInput, date: ISODate): Fit | null {
  return fitSessions(sessionsOf(input, date));
}

/** Weight for 8 reps at the next session, before rounding, as logged. */
export function predictRaw(input: ModelInput, date: ISODate): Prediction | null {
  const fit = fitOn(input, date);
  return fit && loggedWeight(input, loadAt(fit, NEXT), bodyweightOn(input.bodyweights, date));
}

/**
 * The nearest real weight for 8 reps at the next session, as logged. The same however
 * long ago the last session was. Null with no entries.
 */
export function predict(input: ModelInput, date: ISODate): Prediction | null {
  const raw = predictRaw(input, date);
  if (raw === null) return null;
  const realWeights = [...liveEntries(input.entries, date).map(({ weightKg }) => weightKg), ...input.rackWeights];
  const floor = noLoadWeight(input, bodyweightOn(input.bodyweights, date));
  return roundToLoadable(raw, input.equipment, realWeights, floor);
}

/**
 * The current fitted trend at 8 reps: a point at each session, ending at `asOf` on the
 * next suggestion. Dots are entries converted to 8 reps.
 */
export function strengthHistory(input: ModelInput, asOf: ISODate): StrengthHistory {
  const sessions = sessionsOf(input, asOf);
  const fit = fitSessions(sessions);
  const line: StrengthPoint[] = [];
  if (fit) {
    sessions.forEach(({ date, bodyweightKg }, index) => {
      line.push({ date, kg: loggedWeight(input, loadAt(fit, index - (sessions.length - 1)), bodyweightKg) });
    });
    if (line.at(-1)?.date === asOf) line.pop();
    line.push({ date: asOf, kg: loggedWeight(input, loadAt(fit, NEXT), bodyweightOn(input.bodyweights, asOf)) });
  }

  const dots = liveEntries(input.entries, asOf).map((entry) => {
    const bodyweightKg = bodyweightOn(input.bodyweights, entry.date);
    const load = effectiveLoad(input, entry.weightKg, bodyweightKg);
    const atTarget = weightFor(e1rm(load, entry.reps), TARGET_REPS);
    return {
      entryId: entry.id,
      date: entry.date,
      kg: loggedWeight(input, atTarget, bodyweightKg),
      colour: colourForReps(entry.reps),
    };
  });

  return { line, dots };
}

/**
 * Estimated 1RM at the next session in logged terms: the e1RM of the unrounded 8-rep
 * suggestion, one hand for per-hand rows and share × bodyweight + added for bodyweight
 * rows. Null with no entries.
 */
export function oneRepMax(input: ModelInput, date: ISODate): number | null {
  const fit = fitOn(input, date);
  if (!fit) return null;
  const load = strengthAt(fit, NEXT);
  return input.equipment !== 'bodyweight' && input.perHand ? load / 2 : load;
}

/** Colour of the last entry by date, ties by updatedAt. 'yellow' with no entries. */
export function lastColour(entries: Entry[]): Colour {
  const latest = liveEntries(entries, '9999-12-31').at(-1);
  return latest ? colourForReps(latest.reps) : 'yellow';
}
