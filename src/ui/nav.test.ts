import { describe, expect, it } from 'vitest';
import { type Route, href, parseRoute } from './nav';

describe('routes', () => {
  it.each<Route>([
    { name: 'home' },
    { name: 'search' },
    { name: 'log', exerciseId: 'Barbell_Bench_Press_-_Medium_Grip' },
    { name: 'log', exerciseId: 'Barbell_Squat', entryId: 'abc' },
    { name: 'exercise', exerciseId: 'Bench/Press' },
    { name: 'map' },
    { name: 'settings' },
  ])('round-trips %j', (route) => {
    expect(parseRoute(href(route))).toEqual(route);
  });

  it('falls back to home', () => {
    expect(parseRoute('#/nonsense')).toEqual({ name: 'home' });
    expect(parseRoute('')).toEqual({ name: 'home' });
  });
});
