import type { Bodyweight, Entry, ISODate } from '../domain/types';
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

/** One date's strongest set, the only thing that feeds the model. */
export interface Session {
  date: ISODate;
  bodyweightKg: number;
  /** ln of the e1RM of the effective load, at whatever reps the set reached. */
  logStrength: number;
}

/**
 * ln e1RM = level + slope × x, fitted to the sessions with x = 0 at the latest session,
 * so x = 1 is the next one and `slope` is K in log terms.
 */
export interface Fit {
  level: number;
  slope: number;
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
    const previous = sessions.at(-1);
    if (previous?.date !== entry.date) sessions.push({ date: entry.date, bodyweightKg, logStrength });
    else if (logStrength >= previous.logStrength) previous.logStrength = logStrength;
  }
  return sessions;
}

/**
 * Weighted least squares with a ridge prior on the slope. Points above and below the
 * trend count alike, so one outlier only adjusts it. Every session counts towards K,
 * whatever its reps. Null with no sessions.
 */
export function fitSessions(sessions: Session[]): Fit | null {
  if (sessions.length === 0) return null;
  const last = sessions.length - 1;
  const points = sessions.map(({ logStrength }, index) => ({
    x: index - last,
    y: logStrength,
    weight: 2 ** ((index - last) / HALF_LIFE_SESSIONS),
  }));
  const total = points.reduce((sum, point) => sum + point.weight, 0);
  const mean = (value: (point: (typeof points)[number]) => number) =>
    points.reduce((sum, point) => sum + point.weight * value(point), 0) / total;
  const [x, y] = [mean((point) => point.x), mean((point) => point.y)];

  let sxx = 0;
  let sxy = 0;
  for (const point of points) {
    sxx += point.weight * (point.x - x) ** 2;
    sxy += point.weight * (point.x - x) * (point.y - y);
  }
  const slope = sxy / (sxx + SLOPE_PRIOR);
  return { level: y - slope * x, slope };
}

/** The fitted e1RM at session x, where 0 is the latest and 1 the next. */
export function strengthAt(fit: Fit, x: number): number {
  return Math.exp(fit.level + fit.slope * x);
}
