import { describe, expect, it } from 'vitest';
import { COLOURS, colourForReps } from '../domain/colour';
import type { Bodyweight, Entry, Equipment, Prediction } from '../domain/types';
import { oneRepMax, predict, predictRaw, strengthHistory } from './index';
import { bodyweightOn } from './load';
import { replay, type ModelInput } from './replay';
import { type Random, seededRandom } from './simulator';
import { log, on, set, weighIn } from './testing';

const EQUIPMENT: Equipment[] = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'kettlebell',
  'bodyweight',
  'other',
];
const LOGS = 120;
const TOLERANCE = 1e-9;

const pick = <T>(random: Random, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)];

/** A messy log: outliers, every rep range, layoffs, very light and very heavy loads. */
function randomLog(random: Random, equipment: Equipment): ModelInput {
  const scale =
    equipment === 'bodyweight' ? 30 : pick(random, equipment === 'dumbbell' ? [2, 5, 20, 50] : [5, 20, 80, 200]);
  const bodyweights: Bodyweight[] = [weighIn(0, 60 + random() * 50), weighIn(100, 60 + random() * 50)];
  const entries: Entry[] = [];
  let day = 0;
  for (let i = 0; i < 25; i++) {
    const swing = random() < 0.15 ? 0.5 + random() * 1.5 : 0.85 + random() * 0.3;
    const weight = Math.round(scale * swing * 4) / 4;
    const logged = equipment === 'bodyweight' && random() < 0.5 ? -weight : weight;
    entries.push(set(day, logged, 1 + Math.floor(random() * 20)));
    day += random() < 0.15 ? 15 + Math.floor(random() * 120) : 1 + Math.floor(random() * 7);
  }
  return log(equipment, entries, bodyweights);
}

/** Total load per colour: the only scale on which a bodyweight percentage means anything. */
function loads(input: ModelInput, day: number): Prediction {
  const raw = predictRaw(input, on(day)) as Prediction;
  if (input.equipment !== 'bodyweight') return raw;
  const bodyweight = bodyweightOn(input.bodyweights, on(day));
  return { red: raw.red + bodyweight, yellow: raw.yellow + bodyweight, green: raw.green + bodyweight };
}

const dayOf = (entry: Entry) => Math.round((Date.parse(entry.date) - Date.parse(on(0))) / 86_400_000);

function forEachLog(run: (input: ModelInput) => void): void {
  const random = seededRandom(20261031);
  for (let i = 0; i < LOGS; i++) run(randomLog(random, EQUIPMENT[i % EQUIPMENT.length]));
}

describe('invariants across random logs', () => {
  it('AC8: the own colour moves by the largest percentage on every save', () => {
    let saves = 0;
    let limited = 0;
    forEachLog((input) => {
      for (let i = 1; i < input.entries.length; i++) {
        const entry = input.entries[i];
        const day = dayOf(entry);
        const before = loads({ ...input, entries: input.entries.slice(0, i) }, day);
        const after = loads({ ...input, entries: input.entries.slice(0, i + 1) }, day);
        const move = (c: keyof Prediction) => Math.abs(Math.log(after[c] / before[c]));
        const own = colourForReps(entry.reps);
        saves += 1;
        for (const other of COLOURS) {
          if (other === own) continue;
          expect(move(other)).toBeLessThanOrEqual(move(own) + TOLERANCE);
          if (move(own) === 0) expect(move(other)).toBe(0);
          const heldByOrder = COLOURS.some((c) => c !== other && Math.abs(after[c] - after[other]) < 1e-6);
          if (heldByOrder) limited += 1;
          else expect(move(other)).toBeLessThanOrEqual(0.9 * move(own) + TOLERANCE);
        }
      }
    });
    expect(saves).toBeGreaterThan(2000);
    expect(limited).toBeLessThan(saves);
  });

  it('keeps red >= yellow >= green at every session and through any time away', () => {
    forEachLog((input) => {
      const lastDay = dayOf(input.entries.at(-1) as Entry);
      for (const day of [lastDay, lastDay + 8, lastDay + 14, lastDay + 60, lastDay + 400, lastDay + 4000]) {
        const raw = predictRaw(input, on(day)) as Prediction;
        expect(raw.red).toBeGreaterThanOrEqual(raw.yellow);
        expect(raw.yellow).toBeGreaterThanOrEqual(raw.green);
      }
      for (const { loads: point } of replay(input, on(lastDay)).timeline) {
        expect(point.red).toBeGreaterThanOrEqual(point.yellow);
        expect(point.yellow).toBeGreaterThanOrEqual(point.green);
      }
    });
  });

  it('keeps the total load of a bodyweight exercise positive, rounded or raw', () => {
    forEachLog((input) => {
      if (input.equipment !== 'bodyweight') return;
      const lastDay = dayOf(input.entries.at(-1) as Entry);
      for (let day = 0; day <= lastDay + 400; day += 37) {
        if (!predict(input, on(day))) continue;
        const bodyweight = bodyweightOn(input.bodyweights, on(day));
        for (const prediction of [predict(input, on(day)), predictRaw(input, on(day))]) {
          for (const colour of COLOURS) {
            expect((prediction as Prediction)[colour] + bodyweight).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  it('keeps loadable weights above zero for loaded equipment', () => {
    forEachLog((input) => {
      if (input.equipment === 'bodyweight') return;
      const predicted = predict(input, on(1000)) as Prediction;
      for (const colour of COLOURS) expect(predicted[colour]).toBeGreaterThan(0);
    });
  });

  it('AC14: deleting entries matches a log that never had them', () => {
    const random = seededRandom(14);
    forEachLog((input) => {
      const deletedIds = new Set(input.entries.filter(() => random() < 0.3).map((entry) => entry.id));
      const tombstoned = input.entries.map((entry) =>
        deletedIds.has(entry.id) ? { ...entry, deleted: true } : entry,
      );
      const withTombstones = { ...input, entries: tombstoned };
      const without = { ...input, entries: input.entries.filter((entry) => !deletedIds.has(entry.id)) };
      const date = on(1000);
      expect(predict(withTombstones, date)).toEqual(predict(without, date));
      expect(predictRaw(withTombstones, date)).toEqual(predictRaw(without, date));
      expect(oneRepMax(withTombstones, date)).toEqual(oneRepMax(without, date));
      expect(strengthHistory(withTombstones, date)).toEqual(strengthHistory(without, date));
    });
  });

  it('is independent of the order entries arrive in', () => {
    const random = seededRandom(7);
    forEachLog((input) => {
      const shuffled = [...input.entries].sort(() => random() - 0.5);
      expect(predictRaw({ ...input, entries: shuffled }, on(1000))).toEqual(predictRaw(input, on(1000)));
    });
  });

  it('never produces a non-finite number', () => {
    forEachLog((input) => {
      const history = strengthHistory(input, on(1000));
      for (const colour of COLOURS) {
        for (const point of history.lines[colour]) expect(Number.isFinite(point.kg)).toBe(true);
      }
      for (const dot of history.dots) expect(Number.isFinite(dot.kg)).toBe(true);
    });
  });
});
