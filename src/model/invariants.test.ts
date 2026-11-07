import { describe, expect, it } from 'vitest';
import { COLOURS } from '../domain/colour';
import type { Bodyweight, Entry, Equipment, Prediction } from '../domain/types';
import { oneRepMax, predict, predictRaw, strengthHistory } from './index';
import type { ModelInput } from './fit';
import { bodyweightOn } from './load';
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
  return log(equipment, entries, bodyweights, {
    perHand: equipment === 'dumbbell' || (equipment === 'cable' && random() < 0.5),
    bodyweightShare: equipment === 'bodyweight' ? pick(random, [1, 0.65, 0.35]) : 1,
    rackWeights: random() < 0.5 ? [scale * 0.9, scale * 1.13] : [],
  });
}

const dayOf = (entry: Entry) => Math.round((Date.parse(entry.date) - Date.parse(on(0))) / 86_400_000);

function forEachLog(run: (input: ModelInput) => void): void {
  const random = seededRandom(20261031);
  for (let i = 0; i < LOGS; i++) run(randomLog(random, EQUIPMENT[i % EQUIPMENT.length]));
}

describe('invariants across random logs', () => {
  it('keeps red >= yellow >= green at every point of the graph, raw and rounded', () => {
    forEachLog((input) => {
      const lastDay = dayOf(input.entries.at(-1) as Entry);
      for (const prediction of [predictRaw(input, on(lastDay)), predict(input, on(lastDay))] as Prediction[]) {
        expect(prediction.red).toBeGreaterThanOrEqual(prediction.yellow);
        expect(prediction.yellow).toBeGreaterThanOrEqual(prediction.green);
      }
      const { lines } = strengthHistory(input, on(lastDay));
      lines.red.forEach((point, i) => {
        expect(point.kg).toBeGreaterThanOrEqual(lines.yellow[i].kg);
        expect(lines.yellow[i].kg).toBeGreaterThanOrEqual(lines.green[i].kg);
      });
    });
  });

  it('AC11: predicts the same however long after the last session', () => {
    forEachLog((input) => {
      const lastDay = dayOf(input.entries.at(-1) as Entry);
      for (const later of [1, 14, 60, 400]) {
        expect(predict(input, on(lastDay + later))).toEqual(predict(input, on(lastDay)));
      }
    });
  });

  it('shows only real weights: on the grid or already logged', () => {
    forEachLog((input) => {
      const step = input.equipment === 'kettlebell' ? 4 : 2.5;
      const real = new Set([...input.entries.map(({ weightKg }) => weightKg), ...input.rackWeights]);
      for (const weight of Object.values(predict(input, on(1000)) as Prediction)) {
        expect(Math.abs(weight / step - Math.round(weight / step)) < 1e-9 || real.has(weight)).toBe(true);
      }
    });
  });

  it('keeps the total load of a bodyweight exercise positive, rounded or raw', () => {
    forEachLog((input) => {
      if (input.equipment !== 'bodyweight') return;
      const lastDay = dayOf(input.entries.at(-1) as Entry);
      for (let day = 0; day <= lastDay + 400; day += 37) {
        if (!predict(input, on(day))) continue;
        const moved = input.bodyweightShare * bodyweightOn(input.bodyweights, on(day));
        for (const prediction of [predict(input, on(day)), predictRaw(input, on(day))]) {
          for (const colour of COLOURS) {
            expect((prediction as Prediction)[colour] + moved).toBeGreaterThan(0);
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
