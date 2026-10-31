import { COLOURS, TARGET_REPS, colourForReps } from '../domain/colour';
import { addDays } from '../domain/date';
import type { Colour, Prediction } from '../domain/types';
import { e1rm, weightFor } from './curve';
import { DEFAULT_BODYWEIGHT_KG, roundToLoadable } from './load';
import { type Outcome, type State, advance, loadsOn, start } from './replay';

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

export interface Persona {
  name: string;
  /** True e1RM on day one, on the starting curve. */
  startStrength: number;
  /** True log-time growth: ln S = ln S0 + growth * ln(1 + t / tau). */
  growth: number;
  tau: number;
  /** Own rep curve: log deviation from the starting curve at each colour's target reps. */
  curve: Prediction;
  /** Standard deviation of the log day effect. */
  noise: number;
  /** Share of a session's gain reaching the colours not trained. */
  spillover: number;
  colourFor: (session: number, random: Random) => Colour;
  layoff?: { afterDay: number; days: number; loss: Prediction };
}

export interface SimulatedSession {
  session: number;
  day: number;
  /** Colour the user set out to train. */
  colour: Colour;
  /** Raw prediction for that colour; null at the first session. */
  predicted: number | null;
  /** What the user could really lift for that colour's target reps that day. */
  actual: number;
  outcome: Outcome;
}

const SESSIONS_END_DAY = 365;
const LOADING_STEP = 2.5;
const LOSS_KEPT_PER_SESSION = 0.8;

function trainingGap(random: Random): number {
  const roll = random();
  if (roll < 0.1) return 7; // A skipped session.
  return roll < 0.55 ? 3 : 4;
}

/** Log deviation at any rep count, linear between the colours' target reps. */
function deviationAt(reps: number, deviation: Prediction): number {
  if (reps <= TARGET_REPS.red) return deviation.red;
  if (reps >= TARGET_REPS.green) return deviation.green;
  const [low, high]: Colour[] = reps <= TARGET_REPS.yellow ? ['red', 'yellow'] : ['yellow', 'green'];
  const share = (reps - TARGET_REPS[low]) / (TARGET_REPS[high] - TARGET_REPS[low]);
  return deviation[low] + share * (deviation[high] - deviation[low]);
}

/**
 * Replays a year of one persona, loading the app's rounded prediction every session and
 * taking the set to the last whole rep. `exact` instead logs the day's true capability at
 * target reps: that removes the floor whole reps put under each observation, which is
 * what would otherwise hide the upward ratchet of beats counting more than misses.
 */
export function simulate(persona: Persona, seed: number, exact = false): SimulatedSession[] {
  const random = seededRandom(seed);
  const deviation = { ...persona.curve };
  const loss: Prediction = { red: 0, yellow: 0, green: 0 };
  const sessions: SimulatedSession[] = [];
  let state: State | null = null;
  let layoffTaken = false;
  let day = 0;
  let age = 0;

  for (let session = 0; day < SESSIONS_END_DAY; session++) {
    const colour = persona.colourFor(session, random);
    const dayEffect = gaussian(random) * persona.noise;
    const capability = (reps: number) =>
      weightFor(persona.startStrength, reps) *
      Math.exp(deviationAt(reps, deviation) - deviationAt(reps, loss) + dayEffect);

    const date = addDays('2026-01-01', day);
    const target = TARGET_REPS[colour];
    const predicted = state ? loadsOn(state, date)[colour] : null;
    const load =
      predicted !== null && state
        ? roundToLoadable(predicted, 'barbell', state.loggedWeights)
        : Math.round(capability(target) / LOADING_STEP) * LOADING_STEP;

    let reps = 1;
    while (reps < 30 && capability(reps + 1) >= load) reps++;
    const exactLoad = Math.round(capability(target) * 4) / 4;

    const logged = {
      date,
      colour: colourForReps(exact ? target : reps),
      bodyweightKg: DEFAULT_BODYWEIGHT_KG,
      observed: exact ? e1rm(exactLoad, target) : e1rm(load, reps),
      loggedWeights: [exact ? exactLoad : load],
    };
    if (state) advance(state, logged);
    else state = start(logged, 'barbell');
    sessions.push({ session, day, colour, predicted, actual: capability(target), outcome: state.outcome });

    const layoff = persona.layoff;
    const pause: Persona['layoff'] | null = layoff !== undefined && !layoffTaken && day >= layoff.afterDay ? layoff : null;
    const gap = pause ? pause.days : trainingGap(random);
    const trainingDays = Math.min(gap, 14);
    const gain =
      persona.growth *
      (Math.log(1 + (age + trainingDays) / persona.tau) - Math.log(1 + age / persona.tau));
    for (const c of COLOURS) {
      deviation[c] += c === colour ? gain : persona.spillover * gain;
      loss[c] = pause ? pause.loss[c] : loss[c] * LOSS_KEPT_PER_SESSION;
    }
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

const rotation =
  (...order: Colour[]) =>
  (session: number) =>
    order[session % order.length];

const blocks =
  (sessionsEach: number, ...order: Colour[]) =>
  (session: number) =>
    order[Math.floor(session / sessionsEach) % order.length];

function mostlyYellow(_session: number, random: Random): Colour {
  const roll = random();
  if (roll < 0.7) return 'yellow';
  return roll < 0.85 ? 'red' : 'green';
}

const LOW_REP_CURVE: Prediction = { red: 0.03, yellow: 0, green: -0.04 };
const HIGH_REP_CURVE: Prediction = { red: -0.03, yellow: 0, green: 0.03 };

export const PERSONAS: Persona[] = [
  {
    name: 'strong at low reps, rotates colours',
    startStrength: 100,
    growth: 0.08,
    tau: 30,
    curve: LOW_REP_CURVE,
    noise: 0.015,
    spillover: 0.7,
    colourFor: rotation('yellow', 'red', 'green'),
  },
  {
    name: 'strong at high reps, rotates colours',
    startStrength: 70,
    growth: 0.1,
    tau: 40,
    curve: HIGH_REP_CURVE,
    noise: 0.012,
    spillover: 0.7,
    colourFor: rotation('green', 'yellow', 'red'),
  },
  {
    name: 'mostly yellow, noisy days',
    startStrength: 130,
    growth: 0.05,
    tau: 30,
    curve: LOW_REP_CURVE,
    noise: 0.02,
    spillover: 0.6,
    colourFor: mostlyYellow,
  },
  {
    name: 'yellow only',
    startStrength: 100,
    growth: 0.08,
    tau: 30,
    curve: LOW_REP_CURVE,
    noise: 0.015,
    spillover: 0.7,
    colourFor: () => 'yellow',
  },
  {
    name: 'eight week layoff',
    startStrength: 110,
    growth: 0.07,
    tau: 30,
    curve: LOW_REP_CURVE,
    noise: 0.015,
    spillover: 0.7,
    colourFor: rotation('yellow', 'red', 'green'),
    layoff: { afterDay: 150, days: 56, loss: { red: 0.04, yellow: 0.06, green: 0.09 } },
  },
  {
    name: 'switches colour every six weeks',
    startStrength: 100,
    growth: 0.08,
    tau: 30,
    curve: LOW_REP_CURVE,
    noise: 0.015,
    spillover: 0.6,
    colourFor: blocks(12, 'yellow', 'red', 'green'),
  },
];
