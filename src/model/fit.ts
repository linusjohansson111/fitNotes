import { COLOURS, colourForReps } from '../domain/colour';
import type { Bodyweight, Colour, Entry, ISODate } from '../domain/types';
import { e1rm } from './curve';
import { type Loading, bodyweightOn, effectiveLoad } from './load';

export interface ModelInput extends Loading {
  entries: Entry[];
  bodyweights: Bodyweight[];
  /** Weights logged on other exercises that share the rack: dumbbells, barbells or kettlebells. */
  rackWeights: number[];
}

/** Recent sessions count most: a session's weight halves every this many sessions. */
const HALF_LIFE_SESSIONS = 6;
/**
 * Pulls K, the change per session, towards 0% until the log shows growth. In units of
 * the newest session's weight, so about 3 sessions outweigh it.
 */
const SLOPE_PRIOR = 1;
/** Pulls each colour's offset towards the starting curve, in the same units. */
const OFFSET_PRIOR = 1;

/** One date's strongest set, the only thing that feeds the model. */
export interface Session {
  date: ISODate;
  colour: Colour;
  bodyweightKg: number;
  /** ln of the e1RM of the effective load. */
  logStrength: number;
}

/**
 * ln e1RM = level + slope × x + offset[colour], fitted to the sessions with x = 0 at the
 * latest session, so x = 1 is the next one and `slope` is K in log terms.
 */
export interface Fit {
  level: number;
  slope: number;
  offsets: Record<Colour, number>;
}

function byTime(a: Entry, b: Entry): number {
  return a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt || a.id.localeCompare(b.id);
}

/** Live entries up to `asOf`, oldest first. Entries may be back-dated, so always sort. */
export function liveEntries(entries: Entry[], asOf: ISODate): Entry[] {
  return entries.filter((entry) => !entry.deleted && entry.date <= asOf).sort(byTime);
}

export function sessionsOf(input: ModelInput, asOf: ISODate): Session[] {
  const sessions: Session[] = [];
  for (const entry of liveEntries(input.entries, asOf)) {
    const bodyweightKg = bodyweightOn(input.bodyweights, entry.date);
    const logStrength = Math.log(e1rm(effectiveLoad(input, entry.weightKg, bodyweightKg), entry.reps));
    const colour = colourForReps(entry.reps);
    const previous = sessions.at(-1);
    if (previous?.date !== entry.date) sessions.push({ date: entry.date, colour, bodyweightKg, logStrength });
    else if (logStrength >= previous.logStrength) Object.assign(previous, { colour, logStrength });
  }
  return sessions;
}

/**
 * Weighted least squares with ridge priors on the slope and the offsets. Points above
 * and below the trend count alike, so one outlier only adjusts it. The slope comes from
 * changes within each colour, so a change of colour never reads as progress; given the
 * slope, each colour's level is its own sessions' level shrunk towards the shared one.
 * Null with no sessions.
 */
export function fitSessions(sessions: Session[]): Fit | null {
  if (sessions.length === 0) return null;
  const last = sessions.length - 1;
  const points = sessions.map(({ colour, logStrength }, index) => ({
    colour,
    x: index - last,
    y: logStrength,
    weight: 2 ** ((index - last) / HALF_LIFE_SESSIONS),
  }));

  const perColour = COLOURS.map((colour) => {
    const own = points.filter((point) => point.colour === colour);
    const weight = own.reduce((sum, point) => sum + point.weight, 0);
    const mean = (value: (point: (typeof own)[number]) => number) =>
      weight === 0 ? 0 : own.reduce((sum, point) => sum + point.weight * value(point), 0) / weight;
    return { colour, own, weight, x: mean(({ x }) => x), y: mean(({ y }) => y) };
  });

  let sxx = 0;
  let sxy = 0;
  for (const { own, x, y } of perColour) {
    for (const point of own) {
      sxx += point.weight * (point.x - x) ** 2;
      sxy += point.weight * (point.x - x) * (point.y - y);
    }
  }
  const slope = sxy / (sxx + SLOPE_PRIOR);

  // Each trained colour's level at the latest session, and how far its data outweighs the prior.
  const trained = perColour
    .filter(({ weight }) => weight > 0)
    .map(({ colour, weight, x, y }) => ({ colour, level: y - slope * x, share: weight / (weight + OFFSET_PRIOR) }));
  const level =
    trained.reduce((sum, { level: own, share }) => sum + share * own, 0) /
    trained.reduce((sum, { share }) => sum + share, 0);
  const offsets = { red: 0, yellow: 0, green: 0 };
  for (const { colour, level: own, share } of trained) offsets[colour] = share * (own - level);
  return { level, slope, offsets };
}

/** The fitted e1RM of `colour` at session x, where 0 is the latest and 1 the next. */
export function strengthAt(fit: Fit, x: number, colour: Colour): number {
  return Math.exp(fit.level + fit.slope * x + fit.offsets[colour]);
}
