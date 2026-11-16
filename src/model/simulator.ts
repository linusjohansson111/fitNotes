import { TARGET_REPS } from '../domain/colour';
import type { Entry } from '../domain/types';
import { weightFor } from './curve';
import { predict, predictRaw } from './index';
import { barbell, on, set } from './testing';

/** Test support: simulated training logs for AC17. Not part of the model. */

export type Random = () => number;

/** Seeded mulberry32, so every simulated log can be reproduced. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(random: Random): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

/** Log deviation from the starting curve at a rep count, as [reps, deviation] pairs. */
type RepCurve = readonly (readonly [reps: number, deviation: number])[];

export interface Persona {
  name: string;
  /** True e1RM on day one, on the starting curve. */
  startStrength: number;
  /** True log-time growth: ln S = ln S0 + growth * ln(1 + t / tau). */
  growth: number;
  tau: number;
  /** Own rep curve, so a set far from 8 reps carries the starting curve's error. */
  curve: RepCurve;
  /** Standard deviation of the log day effect. */
  noise: number;
  layoff?: { afterDay: number; days: number; loss: number };
}

export interface SimulatedSession {
  session: number;
  day: number;
  /** Raw prediction for 8 reps; null at the first session. */
  predicted: number | null;
  /** What the user could really lift for 8 reps that day. */
  actual: number;
  /** Reps actually reached on the loaded weight. */
  reps: number;
}

const SESSIONS_END_DAY = 365;
const LOADING_STEP = 2.5;
const LOSS_KEPT_PER_SESSION = 0.8;

function trainingGap(random: Random): number {
  const roll = random();
  if (roll < 0.1) return 7; // A skipped session.
  return roll < 0.55 ? 3 : 4;
}

/** Linear between the curve's points, and its nearest point beyond them. */
function deviationAt(reps: number, curve: RepCurve): number {
  const next = curve.findIndex(([at]) => at >= reps);
  if (next === 0) return curve[0][1];
  if (next === -1) return curve[curve.length - 1][1];
  const [[lowReps, low], [highReps, high]] = [curve[next - 1], curve[next]];
  return low + ((reps - lowReps) / (highReps - lowReps)) * (high - low);
}

/**
 * Replays a year of one persona aiming at 8 reps: loading the app's rounded suggestion
 * every session and taking the set to the last whole rep, so the reps reached vary
 * around 8 with the day and with growth.
 */
export function simulate(persona: Persona, seed: number): SimulatedSession[] {
  const random = seededRandom(seed);
  const sessions: SimulatedSession[] = [];
  const entries: Entry[] = [];
  let gained = 0;
  let loss = 0;
  let layoffTaken = false;
  let day = 0;
  let age = 0;

  for (let session = 0; day < SESSIONS_END_DAY; session++) {
    const dayEffect = gaussian(random) * persona.noise;
    const capability = (reps: number) =>
      weightFor(persona.startStrength, reps) * Math.exp(deviationAt(reps, persona.curve) + gained - loss + dayEffect);

    const input = barbell(...entries);
    const predicted = predictRaw(input, on(day));
    const load = predict(input, on(day)) ?? Math.round(capability(TARGET_REPS) / LOADING_STEP) * LOADING_STEP;

    let reps = 1;
    while (reps < 30 && capability(reps + 1) >= load) reps++;
    entries.push(set(day, load, reps));
    sessions.push({ session, day, predicted, actual: capability(TARGET_REPS), reps });

    const layoff = persona.layoff;
    const pause: Persona['layoff'] | null = layoff !== undefined && !layoffTaken && day >= layoff.afterDay ? layoff : null;
    const gap = pause ? pause.days : trainingGap(random);
    const trainingDays = Math.min(gap, 14);
    gained +=
      persona.growth *
      (Math.log(1 + (age + trainingDays) / persona.tau) - Math.log(1 + age / persona.tau));
    loss = pause ? pause.loss : loss * LOSS_KEPT_PER_SESSION;
    layoffTaken ||= pause !== null;
    age += trainingDays;
    day += gap;
  }
  return sessions;
}

/** Signed percentage error of each prediction, skipping the first session, which has none. */
export function percentageErrors(sessions: SimulatedSession[]): number[] {
  return sessions.flatMap(({ predicted, actual }) =>
    predicted === null ? [] : [(100 * (predicted - actual)) / actual],
  );
}

const LOW_REP_CURVE: RepCurve = [
  [5, 0.03],
  [8, 0],
  [11, -0.04],
];
const HIGH_REP_CURVE: RepCurve = [
  [5, -0.03],
  [8, 0],
  [11, 0.03],
];

export const PERSONAS: Persona[] = [
  {
    name: 'strong at low reps',
    startStrength: 100,
    growth: 0.08,
    tau: 30,
    curve: LOW_REP_CURVE,
    noise: 0.015,
  },
  {
    name: 'strong at high reps',
    startStrength: 70,
    growth: 0.1,
    tau: 40,
    curve: HIGH_REP_CURVE,
    noise: 0.012,
  },
  {
    name: 'noisy days, reps swing widely',
    startStrength: 130,
    growth: 0.05,
    tau: 30,
    curve: LOW_REP_CURVE,
    noise: 0.03,
  },
  {
    name: 'eight week layoff',
    startStrength: 110,
    growth: 0.07,
    tau: 30,
    curve: LOW_REP_CURVE,
    noise: 0.015,
    layoff: { afterDay: 150, days: 56, loss: 0.06 },
  },
];
