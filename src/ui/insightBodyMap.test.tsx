import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Muscle } from '../domain/types';
import { BodyMap, sameMap } from './BodyMap';
import { BACK, type BodyPolygon, FRONT } from './bodyShapes';
import { MUSCLE_NAMES } from './insightMuscles';

afterEach(cleanup);

const fillsOf = (container: HTMLElement) =>
  [...container.querySelectorAll('polygon')].map((polygon) => polygon.style.fill);

/** Which muscle each polygon belongs to, read from its click. */
function polygonsByMuscle(): Map<Muscle, string[]> {
  const found = new Map<Muscle, string[]>();
  const onMuscle = vi.fn<(muscle: Muscle) => void>();
  const { container, unmount } = render(<BodyMap fills={{}} onMuscle={onMuscle} />);
  for (const polygon of container.querySelectorAll('polygon')) {
    onMuscle.mockClear();
    fireEvent.click(polygon);
    const muscle = onMuscle.mock.calls[0]?.[0];
    if (muscle) found.set(muscle, [...(found.get(muscle) ?? []), polygon.getAttribute('points') ?? '']);
  }
  unmount();
  return found;
}

/** How far a polygon's corners sit from the midline, on average. */
function fromMidline(points: string): number {
  const xs = points.split(' ').filter((_, index) => index % 2 === 0).map(Number);
  return xs.reduce((sum, x) => sum + Math.abs(x - 50), 0) / xs.length;
}

describe('body shapes', () => {
  it.each([
    ['front', FRONT],
    ['back', BACK],
  ])('puts the adductors on the inner thigh and the abductors on the outer hip of the %s figure', (_, figure: BodyPolygon[]) => {
    const spread = (muscle: Muscle) => figure.filter((polygon) => polygon.muscle === muscle).map(({ points }) => fromMidline(points));
    const adductor = spread('adductor');
    const abductors = spread('abductors');
    expect(adductor).toHaveLength(2);
    expect(abductors).toHaveLength(2);
    expect(Math.min(...abductors)).toBeGreaterThan(Math.max(...adductor));
  });

  it('keeps every corner inside the viewBox', () => {
    for (const { points } of [...FRONT, ...BACK]) {
      const values = points.split(' ').map(Number);
      expect(values.length % 2).toBe(0);
      values.forEach((value, index) => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(index % 2 === 0 ? 100 : 200);
      });
    }
  });
});

describe('BodyMap', () => {
  it('draws a front and a back figure in the plain body colour', () => {
    const { container } = render(<BodyMap fills={{}} />);
    expect(container.querySelectorAll('svg')).toHaveLength(2);
    expect(new Set(fillsOf(container))).toEqual(new Set(['rgb(58, 58, 60)']));
  });

  it('paints every polygon of a muscle in exactly the colour asked for', () => {
    const polygons = polygonsByMuscle();
    const fills = { chest: '#ff3b30', calves: '#30d158', abs: '#ffd60a' };
    const { container } = render(<BodyMap fills={fills} />);
    const fillAt = (points: string) => container.querySelector<SVGElement>(`polygon[points="${points}"]`)?.style.fill;
    expect(polygons.get('chest')?.map(fillAt).every((fill) => fill === 'rgb(255, 59, 48)')).toBe(true);
    expect(polygons.get('calves')?.map(fillAt).every((fill) => fill === 'rgb(48, 209, 88)')).toBe(true);
    expect(polygons.get('abs')?.map(fillAt).every((fill) => fill === 'rgb(255, 214, 10)')).toBe(true);
  });

  it('reports only muscles the app knows, so head and knees stay silent', () => {
    const onMuscle = vi.fn();
    const { container } = render(<BodyMap fills={{}} onMuscle={onMuscle} />);
    for (const polygon of container.querySelectorAll('polygon')) fireEvent.click(polygon);
    const tapped = new Set(onMuscle.mock.calls.map(([muscle]) => muscle as string));
    expect([...tapped].sort()).toEqual(Object.keys(MUSCLE_NAMES).sort());
  });

  it('treats an equal fills object as the same map, so it does not re-render', () => {
    const onMuscle = () => {};
    expect(sameMap({ fills: { chest: '#ff3b30' } }, { fills: { chest: '#ff3b30' } })).toBe(true);
    expect(sameMap({ fills: { chest: '#ff3b30' } }, { fills: { chest: '#30d158' } })).toBe(false);
    expect(sameMap({ fills: { chest: '#ff3b30' } }, { fills: { chest: '#ff3b30', abs: '#ff3b30' } })).toBe(false);
    expect(sameMap({ fills: {}, height: 100 }, { fills: {}, height: 56 })).toBe(false);
    expect(sameMap({ fills: {}, onMuscle }, { fills: {}, onMuscle })).toBe(true);
    expect(sameMap({ fills: {}, onMuscle }, { fills: {} })).toBe(false);
  });

  it('repaints when fills change', () => {
    const { container, rerender } = render(<BodyMap fills={{ chest: '#ff3b30' }} />);
    rerender(<BodyMap fills={{ chest: '#30d158' }} />);
    expect(fillsOf(container)).toContain('rgb(48, 209, 88)');
  });

  it('fits two half-height figures and their gap, and marks itself tappable only with onMuscle', () => {
    const { container, rerender } = render(<BodyMap fills={{}} height={100} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('105px');
    expect(root.style.gap).toBe('5px');
    expect(root.className).toBe('ins-body');
    rerender(<BodyMap fills={{}} height={100} onMuscle={() => {}} />);
    expect(root.className).toContain('ins-body--tap');
  });
});
