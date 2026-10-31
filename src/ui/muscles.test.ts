import { describe, expect, it } from 'vitest';
import type { Group, Muscle } from '../domain/types';
import { PRIMARY_FILL, SECONDARY_FILL, cycleMuscle, groupOfMuscle, muscleFills } from './muscles';

describe('AC3: tapped muscles', () => {
  it('cycles none, primary, secondary, none', () => {
    const none = { primary: [], secondary: [] };
    const primary = cycleMuscle(none, 'chest');
    expect(primary).toEqual({ primary: ['chest'], secondary: [] });
    const secondary = cycleMuscle(primary, 'chest');
    expect(secondary).toEqual({ primary: [], secondary: ['chest'] });
    expect(cycleMuscle(secondary, 'chest')).toEqual(none);
  });

  it('keeps tapping order, so the first primary stays first', () => {
    let selection = cycleMuscle({ primary: [], secondary: [] }, 'biceps');
    selection = cycleMuscle(selection, 'chest');
    selection = cycleMuscle(selection, 'abs');
    expect(selection.primary).toEqual(['biceps', 'chest', 'abs']);
    expect(cycleMuscle(selection, 'biceps').primary).toEqual(['chest', 'abs']);
  });

  it('fills primary brighter than secondary, primary winning a muscle listed as both', () => {
    expect(muscleFills(['chest', 'abs'], ['triceps', 'abs'])).toEqual({
      chest: PRIMARY_FILL,
      abs: PRIMARY_FILL,
      triceps: SECONDARY_FILL,
    });
    expect(PRIMARY_FILL).toBe('#ffffff');
    expect(SECONDARY_FILL).toBe('#636366');
  });

  it.each<[Muscle, Group]>([
    ['chest', 'Chest'],
    ['upper-back', 'Back'],
    ['lower-back', 'Back'],
    ['trapezius', 'Back'],
    ['front-deltoids', 'Shoulders'],
    ['back-deltoids', 'Shoulders'],
    ['neck', 'Shoulders'],
    ['biceps', 'Arms'],
    ['triceps', 'Arms'],
    ['forearm', 'Arms'],
    ['quadriceps', 'Legs'],
    ['hamstring', 'Legs'],
    ['gluteal', 'Legs'],
    ['calves', 'Legs'],
    ['adductor', 'Legs'],
    ['abductors', 'Legs'],
    ['abs', 'Core'],
    ['obliques', 'Core'],
  ])('puts %s in %s', (muscle, group) => {
    expect(groupOfMuscle(muscle)).toBe(group);
  });
});
