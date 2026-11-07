import { describe, expect, it } from 'vitest';
import type { Bodyweight } from '../domain/types';
import {
  DEFAULT_BODYWEIGHT_KG,
  type Loading,
  bodyweightOn,
  effectiveLoad,
  gridStep,
  loggedWeight,
  noLoadWeight,
  roundToLoadable,
} from './load';

const weighIn = (date: string, kg: number, deleted?: boolean): Bodyweight => ({
  date,
  kg,
  deleted,
  updatedAt: 0,
});

describe('bodyweightOn', () => {
  const records = [weighIn('2026-03-01', 82), weighIn('2026-01-01', 78), weighIn('2026-02-01', 90, true)];

  it('takes the latest live record on or before the date', () => {
    expect(bodyweightOn(records, '2026-02-15')).toBe(78);
    expect(bodyweightOn(records, '2026-03-01')).toBe(82);
  });

  it('falls back to the earliest record, then the default', () => {
    expect(bodyweightOn(records, '2025-01-01')).toBe(78);
    expect(bodyweightOn([weighIn('2026-01-01', 70, true)], '2026-02-01')).toBe(DEFAULT_BODYWEIGHT_KG);
    expect(DEFAULT_BODYWEIGHT_KG).toBe(80);
  });
});

const BARBELL: Loading = { equipment: 'barbell', perHand: false, bodyweightShare: 1 };
const PAIR: Loading = { equipment: 'dumbbell', perHand: true, bodyweightShare: 1 };
const ONE_DUMBBELL: Loading = { equipment: 'dumbbell', perHand: false, bodyweightShare: 1 };
const PULL_UP: Loading = { equipment: 'bodyweight', perHand: false, bodyweightShare: 1 };
const PUSH_UP: Loading = { equipment: 'bodyweight', perHand: false, bodyweightShare: 0.65 };

describe('effective load', () => {
  it('round-trips through logged terms', () => {
    const cases: [Loading, number, number][] = [
      [BARBELL, 80, 80],
      [PAIR, 20, 40],
      [ONE_DUMBBELL, 20, 20],
      [PULL_UP, -10, 80],
      [PUSH_UP, 10, 68.5],
    ];
    for (const [loading, logged, load] of cases) {
      expect(effectiveLoad(loading, logged, 90)).toBeCloseTo(load, 10);
      expect(loggedWeight(loading, load, 90)).toBeCloseTo(logged, 10);
    }
  });

  it('stays positive when assistance reaches the share of bodyweight', () => {
    expect(effectiveLoad(PULL_UP, -100, 80)).toBeGreaterThan(0);
    expect(effectiveLoad(PUSH_UP, -52, 80)).toBeGreaterThan(0);
  });

  it('knows the weight that leaves no load', () => {
    expect(noLoadWeight(BARBELL, 80)).toBe(0);
    expect(noLoadWeight(PULL_UP, 80)).toBe(-80);
    expect(noLoadWeight(PUSH_UP, 80)).toBeCloseTo(-52, 10);
  });
});

describe('gridStep', () => {
  it.each([
    ['barbell', 2.5],
    ['dumbbell', 2.5],
    ['machine', 2.5],
    ['cable', 2.5],
    ['kettlebell', 4],
    ['bodyweight', 2.5],
    ['other', 2.5],
  ] as const)('is %s kg for %s', (equipment, step) => {
    expect(gridStep(equipment)).toBe(step);
  });
});

describe('roundToLoadable', () => {
  it('lands the AC7 weights on the grid', () => {
    expect(roundToLoadable(88, 'barbell', [80])).toBe(87.5);
    expect(roundToLoadable(73.5, 'barbell', [80])).toBe(72.5);
  });

  it('AC29: never shows a dumbbell that does not exist', () => {
    expect(roundToLoadable(39.4, 'dumbbell', [40, 37.5])).toBe(40);
    expect(roundToLoadable(33.6, 'dumbbell', [40, 37.5])).toBe(32.5);
  });

  it('snaps to a weight already logged, off the grid', () => {
    expect(roundToLoadable(21.3, 'dumbbell', [21])).toBe(21);
    expect(roundToLoadable(14, 'cable', [7.5, 12.5, 17.5])).toBe(15);
    expect(roundToLoadable(13.5, 'machine', [13.4])).toBe(13.4);
  });

  it('snaps kettlebells to 4 kg steps', () => {
    expect(roundToLoadable(18.5, 'kettlebell', [])).toBe(20);
    expect(roundToLoadable(17.9, 'kettlebell', [])).toBe(16);
    expect(roundToLoadable(17.9, 'kettlebell', [18])).toBe(18);
  });

  it('breaks ties towards the lighter weight', () => {
    expect(roundToLoadable(83.75, 'barbell', [])).toBe(82.5);
  });

  it('works for negative weights', () => {
    expect(roundToLoadable(-18.6, 'bodyweight', [0], -80)).toBe(-17.5);
    expect(roundToLoadable(-13.9, 'bodyweight', [-20, -14, -5], -80)).toBe(-14);
  });

  it('never rounds to no load', () => {
    expect(roundToLoadable(-79.9, 'bodyweight', [-60], -80)).toBe(-77.5);
    expect(roundToLoadable(-60, 'bodyweight', [-70], -52)).toBe(-50);
    expect(roundToLoadable(0.4, 'dumbbell', [6])).toBe(2.5);
    expect(roundToLoadable(0.4, 'barbell', [])).toBe(2.5);
    expect(roundToLoadable(-3, 'barbell', [-1])).toBe(2.5);
  });
});
