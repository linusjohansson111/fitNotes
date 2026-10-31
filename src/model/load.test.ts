import { describe, expect, it } from 'vitest';
import type { Bodyweight } from '../domain/types';
import {
  DEFAULT_BODYWEIGHT_KG,
  bodyweightOn,
  effectiveLoad,
  loadableStep,
  loggedWeight,
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

describe('effective load', () => {
  it('round-trips through logged terms', () => {
    expect(effectiveLoad('barbell', 80, 90)).toBe(80);
    expect(effectiveLoad('dumbbell', 20, 90)).toBe(40);
    expect(effectiveLoad('bodyweight', -10, 90)).toBe(80);
    expect(loggedWeight('barbell', 80, 90)).toBe(80);
    expect(loggedWeight('dumbbell', 40, 90)).toBe(20);
    expect(loggedWeight('bodyweight', 80, 90)).toBe(-10);
  });

  it('stays positive when assistance reaches bodyweight', () => {
    expect(effectiveLoad('bodyweight', -100, 80)).toBeGreaterThan(0);
  });
});

describe('loadableStep', () => {
  it.each([
    ['barbell', 2.5],
    ['dumbbell', 2],
    ['machine', 2.5],
    ['cable', 2.5],
    ['kettlebell', 4],
    ['bodyweight', 2.5],
    ['other', 2.5],
  ] as const)('defaults for %s', (equipment, step) => {
    expect(loadableStep(equipment, [])).toBe(step);
    expect(loadableStep(equipment, [80, 80, 85])).toBe(step);
  });

  it('learns the GCD of differences from 3 distinct weights', () => {
    expect(loadableStep('barbell', [60, 70, 65])).toBe(5);
    expect(loadableStep('machine', [40, 41.25, 45])).toBe(1.25);
    expect(loadableStep('dumbbell', [7.5, 12.5, 17.5])).toBe(5);
  });

  it('learns from negative weights', () => {
    expect(loadableStep('bodyweight', [-20, -15, -5])).toBe(5);
  });
});

describe('roundToLoadable', () => {
  it('lands the AC7 weights on the barbell default', () => {
    expect(roundToLoadable(88, 'barbell', [80])).toBe(87.5);
    expect(roundToLoadable(73.5, 'barbell', [80])).toBe(72.5);
  });

  it('keeps offset stacks on their offset', () => {
    expect(roundToLoadable(14, 'cable', [7.5, 12.5, 17.5])).toBe(12.5);
    expect(roundToLoadable(16, 'cable', [7.5, 12.5, 17.5])).toBe(17.5);
    expect(roundToLoadable(26, 'cable', [7.5, 12.5, 17.5])).toBe(27.5);
  });

  it('works for negative weights', () => {
    expect(roundToLoadable(-18.6, 'bodyweight', [0])).toBe(-17.5);
    expect(roundToLoadable(-13.9, 'bodyweight', [-20, -15, -5])).toBe(-15);
  });

  it('never rounds to no load', () => {
    expect(roundToLoadable(-79.9, 'bodyweight', [-60], 80)).toBe(-77.5);
    expect(roundToLoadable(0.4, 'dumbbell', [6])).toBe(2);
    expect(roundToLoadable(0.4, 'barbell', [])).toBe(2.5);
  });
});
