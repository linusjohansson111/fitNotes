import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Muscle } from '../domain/types';
import { BodyMap, highlightFor } from './BodyMap';
import { MUSCLE_NAMES } from './insightMuscles';

const renders = vi.hoisted(() => ({ count: 0 }));

/** The real library, behind a counter of how often BodyMap renders a figure. */
vi.mock('react-body-highlighter', async (importOriginal) => {
  const library = await importOriginal<typeof import('react-body-highlighter')>();
  const Model = library.default;
  return {
    ...library,
    default: (props: ComponentProps<typeof Model>) => {
      renders.count += 1;
      return <Model {...props} />;
    },
  };
});

afterEach(cleanup);

const fillsOf = (container: HTMLElement) =>
  [...container.querySelectorAll('polygon')].map((polygon) => polygon.style.fill);

/** Which muscle each polygon belongs to, read from the library's own click. */
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

describe('highlightFor', () => {
  it('gives each muscle one row whose frequency is its colour index + 1', () => {
    const { colours, rows } = highlightFor({ chest: '#111111', abs: '#222222', calves: '#111111' });
    expect(colours).toEqual(['#111111', '#222222']);
    expect(rows).toEqual([
      { name: 'chest', muscles: ['chest'], frequency: 1 },
      { name: 'abs', muscles: ['abs'], frequency: 2 },
      { name: 'calves', muscles: ['calves'], frequency: 1 },
    ]);
  });

  it('keeps a colour per muscle across a continuous scale', () => {
    const fills = Object.fromEntries(
      (Object.keys(MUSCLE_NAMES) as Muscle[]).map((muscle, index) => [muscle, `#00${String(index).padStart(2, '0')}00`]),
    );
    const { colours, rows } = highlightFor(fills);
    for (const row of rows) expect(colours[(row.frequency as number) - 1]).toBe(fills[row.muscles[0]]);
  });

  it('skips muscles without a colour', () => {
    expect(highlightFor({ chest: undefined }).rows).toEqual([]);
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

  it('does not re-render for an equal fills object', () => {
    const { container, rerender } = render(<BodyMap fills={{ chest: '#ff3b30' }} />);
    const before = renders.count;
    rerender(<BodyMap fills={{ chest: '#ff3b30' }} />);
    expect(renders.count).toBe(before);
    rerender(<BodyMap fills={{ chest: '#30d158' }} />);
    expect(renders.count).toBeGreaterThan(before);
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
