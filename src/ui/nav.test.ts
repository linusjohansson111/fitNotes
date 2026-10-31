import { describe, expect, it } from 'vitest';
import { type Route, href, parseRoute } from './nav';

describe('routes', () => {
  it.each<Route>([
    { name: 'home' },
    { name: 'search' },
    { name: 'custom' },
    { name: 'custom', initialName: 'Cable thing / left' },
    { name: 'log', exerciseId: 'Barbell_Bench_Press_-_Medium_Grip' },
    { name: 'log', exerciseId: 'custom_1', entryId: 'abc' },
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
