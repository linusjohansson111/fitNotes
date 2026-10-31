import { COLOURS, TARGET_REPS, colourForReps } from '../domain/colour';
import { daysBetween } from '../domain/date';
import type { Bodyweight, Colour, Entry, Equipment, ISODate, Prediction } from '../domain/types';
import { e1rm, weightFor } from './curve';
import { bodyweightOn, effectiveLoad, loggedWeight, roundToLoadable } from './load';

export interface ModelInput {
  equipment: Equipment;
  entries: Entry[];
  bodyweights: Bodyweight[];
}

/** Log-strength response of the entry's own colour to a 1st, 2nd and later miss in a row. */
const MISS_RESPONSE = [0.1, 0.4, 0.7];
/** Other colours may move at most this share of the entry's own colour (AC8). */
const OTHER_COLOUR_LIMIT = 0.9;
const REBOUND_SHARE = 0.4;

const GROWTH_PRIOR = 0.05;
const GROWTH_SHRINK = 0.25;
const GROWTH_TAU_DAYS = 30;
const GAP_CAP_DAYS = 14;
const DEFAULT_GAP_DAYS = 7;
const RECENT_GAPS = 5;

const CARRY_SHRINK = 0.005;
const CARRY_MAX = 0.9;
const CARRY_PRIOR: Record<Colour, Prediction> = {
  red: { red: 1, yellow: 0.5, green: 0.25 },
  yellow: { red: 0.5, yellow: 1, green: 0.5 },
  green: { red: 0.25, yellow: 0.5, green: 1 },
};

/** A normal weekly cadence carries no time-away drag. */
const DECAY_GRACE_DAYS = 7;
const DECAY: Record<Colour, { amount: number; days: number; shape: number }> = {
  red: { amount: 0.25, days: 150, shape: 1.6 },
  yellow: { amount: 0.275, days: 125, shape: 1.5 },
  green: { amount: 0.3, days: 100, shape: 1.4 },
};

/** One date's strongest set, the only thing that feeds the model. */
export interface Session {
  date: ISODate;
  colour: Colour;
  bodyweightKg: number;
  /** e1RM of the effective load. */
  observed: number;
  /** Every weight logged that date, including sets that did not feed the model. */
  loggedWeights: number[];
}

export type Outcome = 'first' | 'beat' | 'hit' | 'miss';

interface Trend {
  n: number;
  x: number;
  y: number;
  xx: number;
  xy: number;
}

interface Regression {
  xx: number;
  xy: number;
}

export interface State {
  equipment: Equipment;
  /** Date of the last session. */
  date: ISODate;
  /** s_c: e1RM units of effective load on `date`, before any later time-away decay. */
  strength: Prediction;
  /** Log strength lost to time away and not yet rebuilt. */
  debt: Prediction;
  missStreak: number;
  outcome: Outcome;
  /** Days of training, with each gap capped so layoffs do not age you. */
  trainingAge: number;
  gaps: number[];
  /** Per-colour stats of ln(observed) against ln(1 + t/tau), from raw observations. */
  trends: Record<Colour, Trend>;
  /** carry[k][j]: how colour j has followed movement in colour k. */
  carry: Record<Colour, Record<Colour, Regression>>;
  /** movedSince[j][k]: own movement in k since colour j was last observed. */
  movedSince: Record<Colour, Prediction>;
  lastObserved: Partial<Record<Colour, number>>;
  loggedWeights: number[];
}

const perColour = <T>(value: (colour: Colour) => T): Record<Colour, T> => ({
  red: value('red'),
  yellow: value('yellow'),
  green: value('green'),
});

function timeAway(colour: Colour, days: number): number {
  const { amount, days: scale, shape } = DECAY[colour];
  const away = Math.max(0, days - DECAY_GRACE_DAYS);
  return amount * (1 - Math.exp(-((away / scale) ** shape)));
}

/** Loads at each colour's target reps. Decay can tip the order at very low loads, so it is reapplied. */
function orderedLoads(strength: Prediction): Prediction {
  const red = weightFor(strength.red, TARGET_REPS.red);
  const yellow = Math.min(red, weightFor(strength.yellow, TARGET_REPS.yellow));
  const green = Math.min(yellow, weightFor(strength.green, TARGET_REPS.green));
  return { red, yellow, green };
}

/** Effective loads at target reps on `date`, including time-away decay. */
export function loadsOn(state: State, date: ISODate): Prediction {
  const days = daysBetween(state.date, date);
  return orderedLoads(perColour((c) => state.strength[c] * Math.exp(-timeAway(c, days))));
}

function growthRate(trends: Record<Colour, Trend>): number {
  let sxy = 0;
  let sxx = 0;
  // Centred per colour, so a change of colour does not read as progress.
  for (const { n, x, y, xx, xy } of Object.values(trends)) {
    if (n === 0) continue;
    sxy += xy - (x * y) / n;
    sxx += xx - (x * x) / n;
  }
  return (sxy + GROWTH_SHRINK * GROWTH_PRIOR) / (sxx + GROWTH_SHRINK);
}

function typicalGap(gaps: number[]): number {
  if (gaps.length === 0) return DEFAULT_GAP_DAYS;
  const recent = gaps.slice(-RECENT_GAPS).sort((a, b) => a - b);
  return recent[Math.floor(recent.length / 2)];
}

/**
 * Gain expected by the next session. Applied once at save, never on a first session, so
 * AC7 shows the curve alone and staying home earns nothing.
 */
function nextGain(state: State): number {
  const age = state.trainingAge;
  const gap = typicalGap(state.gaps);
  const span = Math.log(1 + (age + gap) / GROWTH_TAU_DAYS) - Math.log(1 + age / GROWTH_TAU_DAYS);
  return Math.max(0, growthRate(state.trends) * span);
}

export function carryOver(state: State, from: Colour, to: Colour): number {
  const { xx, xy } = state.carry[from][to];
  const prior = CARRY_PRIOR[from][to];
  return Math.min(CARRY_MAX, Math.max(0, (xy + CARRY_SHRINK * prior) / (xx + CARRY_SHRINK)));
}

function recordObservation(state: State, session: Session): void {
  const j = session.colour;
  const previous = state.lastObserved[j];
  if (previous !== undefined) {
    const y = Math.log(session.observed / previous);
    for (const k of COLOURS) {
      const x = state.movedSince[j][k];
      if (k === j || x === 0) continue;
      state.carry[k][j].xy += x * y;
      state.carry[k][j].xx += x * x;
    }
  }
  state.lastObserved[j] = session.observed;
  state.movedSince[j] = perColour(() => 0);

  // A hit only says "at least what was shown", so it is no evidence of a flat trend. If it
  // counted, a user following the app would teach the model zero growth and stall it.
  if (state.outcome === 'hit') return;
  const trend = state.trends[j];
  const x = Math.log(1 + state.trainingAge / GROWTH_TAU_DAYS);
  const y = Math.log(session.observed);
  trend.n += 1;
  trend.x += x;
  trend.y += y;
  trend.xx += x * x;
  trend.xy += x * y;
}

export function start(session: Session, equipment: Equipment): State {
  const state: State = {
    equipment,
    date: session.date,
    strength: perColour(() => session.observed),
    debt: perColour(() => 0),
    missStreak: 0,
    outcome: 'first',
    trainingAge: 0,
    gaps: [],
    trends: perColour(() => ({ n: 0, x: 0, y: 0, xx: 0, xy: 0 })),
    carry: perColour(() => perColour(() => ({ xx: 0, xy: 0 }))),
    movedSince: perColour(() => perColour(() => 0)),
    lastObserved: {},
    loggedWeights: [...session.loggedWeights],
  };
  recordObservation(state, session);
  return state;
}

/**
 * Limits the other colours' moves away from `before` (AC8), then lifts anything heavier
 * than `own` that `own` has passed; `orderedLoads` does the same for anything lighter on
 * every read. The order never needs a colour to move further than `own`, because the
 * colours were in order before it moved, so the two rules cannot conflict.
 */
function settleLoads(before: Prediction, after: Prediction, own: Colour): Prediction {
  const limit = OTHER_COLOUR_LIMIT * Math.abs(Math.log(after[own] / before[own]));
  const loads = perColour((c) => {
    if (c === own) return after[c];
    const move = Math.log(after[c] / before[c]);
    return before[c] * Math.exp(Math.min(limit, Math.max(-limit, move)));
  });
  for (let i = COLOURS.indexOf(own) - 1; i >= 0; i--) {
    loads[COLOURS[i]] = Math.max(loads[COLOURS[i]], loads[COLOURS[i + 1]]);
  }
  return loads;
}

/** Folds one later session into `state`. */
export function advance(state: State, session: Session): void {
  const own = session.colour;
  const days = daysBetween(state.date, session.date);
  const before = loadsOn(state, session.date);
  const predicted = e1rm(before[own], TARGET_REPS[own]);
  const delta = Math.log(session.observed / predicted);

  // A set at the weight the app showed is a hit even when the raw value sat above it.
  const shown = roundToLoadable(
    loggedWeight(state.equipment, before[own], session.bodyweightKg),
    state.equipment,
    state.loggedWeights,
    session.bodyweightKg,
  );
  const shownLoad = effectiveLoad(state.equipment, shown, session.bodyweightKg);
  const beat = delta > 0;
  const miss = !beat && session.observed < e1rm(shownLoad, TARGET_REPS[own]);

  state.missStreak = miss ? state.missStreak + 1 : 0;
  state.outcome = beat ? 'beat' : miss ? 'miss' : 'hit';
  const response = miss ? MISS_RESPONSE[Math.min(state.missStreak, MISS_RESPONSE.length) - 1] : 1;
  const ownShift = beat || miss ? response * delta : 0;

  state.trainingAge += Math.min(days, GAP_CAP_DAYS);
  state.gaps.push(Math.min(days, GAP_CAP_DAYS));

  const carried = perColour((c) => (c === own ? ownShift : carryOver(state, own, c) * ownShift));
  const debt = perColour((c) => {
    const owed = state.debt[c] + timeAway(c, days);
    return beat ? Math.max(0, owed - carried[c]) : owed;
  });

  recordObservation(state, session);
  for (const j of COLOURS) state.movedSince[j][own] += ownShift;
  state.loggedWeights.push(...session.loggedWeights);

  // Growth is suppressed on a miss, or a small first miss could raise the prediction (AC10).
  const growth = miss ? 0 : nextGain(state);
  const after = perColour((c) => {
    const lift = carried[c] + REBOUND_SHARE * debt[c] + growth;
    return weightFor(e1rm(before[c], TARGET_REPS[c]) * Math.exp(lift), TARGET_REPS[c]);
  });
  const loads = settleLoads(before, after, own);

  state.date = session.date;
  state.debt = perColour((c) => (1 - REBOUND_SHARE) * debt[c]);
  state.strength = perColour((c) => e1rm(loads[c], TARGET_REPS[c]));
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
    const load = effectiveLoad(input.equipment, entry.weightKg, bodyweightKg);
    const observed = e1rm(load, entry.reps);
    const previous = sessions.at(-1);
    if (previous?.date === entry.date) {
      previous.loggedWeights.push(entry.weightKg);
      if (observed >= previous.observed) {
        previous.observed = observed;
        previous.colour = colourForReps(entry.reps);
      }
    } else {
      sessions.push({
        date: entry.date,
        colour: colourForReps(entry.reps),
        bodyweightKg,
        observed,
        loggedWeights: [entry.weightKg],
      });
    }
  }
  return sessions;
}

export interface Replay {
  /** Null with no entries. */
  state: State | null;
  /** Loads straight after each session, oldest first. */
  timeline: { date: ISODate; loads: Prediction; bodyweightKg: number; outcome: Outcome }[];
}

export function replay(input: ModelInput, asOf: ISODate): Replay {
  let state: State | null = null;
  const timeline: Replay['timeline'] = [];
  for (const session of sessionsOf(input, asOf)) {
    if (state) advance(state, session);
    else state = start(session, input.equipment);
    timeline.push({
      date: session.date,
      loads: loadsOn(state, session.date),
      bodyweightKg: session.bodyweightKg,
      outcome: state.outcome,
    });
  }
  return { state, timeline };
}
