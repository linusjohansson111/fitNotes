import { describe, expect, it } from 'vitest';
import { addDays } from '../domain/date';
import type { Colour, ISODate } from '../domain/types';
import type { StrengthHistory, StrengthPoint } from '../model';
import {
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  clipLine,
  dotRadius,
  layoutGraph,
  valueAt,
  visibleWindow,
  yDomain,
  yTicks,
} from './StrengthGraphMath';

const ASOF = '2026-10-31';

function history(points: StrengthPoint[], dots: StrengthHistory['dots'] = []): StrengthHistory {
  const shifted = (kg: number) => points.map((point) => ({ ...point, kg: point.kg + kg }));
  return { lines: { red: shifted(10), yellow: shifted(0), green: shifted(-10) }, dots };
}

const dot = (date: ISODate, kg: number, colour: Colour = 'yellow') => ({ entryId: `${date}-${colour}`, date, kg, colour });

/** Every number in a path, in order: x, y, x, y. */
function coordinates(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

function expectInsideGraph(d: string) {
  const values = coordinates(d);
  expect(values.length).toBeGreaterThanOrEqual(4);
  values.forEach((value, index) => {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(index % 2 === 0 ? GRAPH_WIDTH : GRAPH_HEIGHT);
  });
}

describe('valueAt', () => {
  const points = [
    { date: '2026-01-01', kg: 100 },
    { date: '2026-01-11', kg: 120 },
  ];

  it('interpolates between points by time', () => {
    expect(valueAt(points, '2026-01-06')).toBe(110);
  });

  it('holds the nearest value beyond the ends', () => {
    expect(valueAt(points, '2025-01-01')).toBe(100);
    expect(valueAt(points, '2027-01-01')).toBe(120);
  });

  it('returns the point on an exact date', () => {
    expect(valueAt(points, '2026-01-11')).toBe(120);
  });
});

describe('clipLine', () => {
  it('reaches both ends of the window, cutting the line at the same slope', () => {
    const line = clipLine(
      [
        { date: '2026-01-01', kg: 100 },
        { date: '2026-01-11', kg: 120 },
        { date: '2026-01-21', kg: 100 },
      ],
      '2026-01-06',
      '2026-01-16',
    );
    expect(line).toEqual([
      { date: '2026-01-06', kg: 110 },
      { date: '2026-01-11', kg: 120 },
      { date: '2026-01-16', kg: 110 },
    ]);
  });

  it('keeps the last known value drawn when the window holds no points', () => {
    expect(clipLine([{ date: '2025-01-01', kg: 90 }], '2026-01-01', '2026-03-01')).toEqual([
      { date: '2026-01-01', kg: 90 },
      { date: '2026-03-01', kg: 90 },
    ]);
  });

  it('takes the later point on a repeated date', () => {
    const line = clipLine(
      [
        { date: ASOF, kg: 80 },
        { date: ASOF, kg: 79 },
      ],
      addDays(ASOF, -14),
      ASOF,
    );
    expect(line).toEqual([
      { date: addDays(ASOF, -14), kg: 79 },
      { date: ASOF, kg: 79 },
    ]);
  });

  it('is empty for a line with no points', () => {
    expect(clipLine([], '2026-01-01', '2026-02-01')).toEqual([]);
  });
});

describe('visibleWindow', () => {
  const long = history([
    { date: '2023-10-31', kg: 60 },
    { date: ASOF, kg: 100 },
  ]);

  it('AC13: 3M, 1Y and All show the last 3 months, the last year, and everything', () => {
    expect(visibleWindow(long, '3M', ASOF)).toEqual({ from: addDays(ASOF, -91), to: ASOF });
    expect(visibleWindow(long, '1Y', ASOF)).toEqual({ from: addDays(ASOF, -365), to: ASOF });
    expect(visibleWindow(long, 'All', ASOF)).toEqual({ from: '2023-10-31', to: ASOF });
  });

  it('narrows a long range to a shorter log', () => {
    const short = history([{ date: '2026-09-01', kg: 80 }, { date: ASOF, kg: 80 }]);
    expect(visibleWindow(short, '1Y', ASOF).from).toBe('2026-09-01');
  });

  it('gives a log of one day a real span', () => {
    expect(visibleWindow(history([{ date: ASOF, kg: 80 }]), '3M', ASOF)).toEqual({ from: addDays(ASOF, -14), to: ASOF });
  });
});

describe('yDomain', () => {
  it('pads the values and is not forced to zero', () => {
    const [low, high] = yDomain([100, 200]);
    expect(low).toBeGreaterThan(50);
    expect(low).toBeLessThan(100);
    expect(high).toBeGreaterThan(200);
  });

  it('opens a span of zero', () => {
    const [low, high] = yDomain([80, 80, 80]);
    expect(low).toBeLessThan(80);
    expect(high).toBeGreaterThan(80);
  });

  it('works below zero', () => {
    const [low, high] = yDomain([-30, -10]);
    expect(low).toBeLessThan(-30);
    expect(high).toBeGreaterThan(-10);
    expect(high).toBeLessThan(0);
  });

  it('stays usable with no values', () => {
    const [low, high] = yDomain([]);
    expect(high).toBeGreaterThan(low);
  });
});

describe('yTicks', () => {
  it('picks round weights inside the domain', () => {
    expect(yTicks(61.3, 92.4)).toEqual([70, 80, 90]);
  });

  it('crosses zero cleanly', () => {
    expect(yTicks(-22, 12)).toEqual([-20, -10, 0, 10]);
  });

  it('gives at least one guide on any span', () => {
    for (const [low, high] of [[79, 81], [79.9, 80.1], [-1, 1], [1000, 1400], [0.1, 0.2], [-81, -79]]) {
      const ticks = yTicks(low, high);
      expect(ticks.length).toBeGreaterThanOrEqual(1);
      expect(ticks.length).toBeLessThanOrEqual(5);
      for (const tick of ticks) {
        expect(tick).toBeGreaterThanOrEqual(low);
        expect(tick).toBeLessThanOrEqual(high);
      }
    }
  });

  it('never prints negative zero or float noise', () => {
    expect(Object.is(yTicks(-1, 1).find((tick) => tick === 0), 0)).toBe(true);
    expect(yTicks(0.1, 0.4)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});

describe('dotRadius', () => {
  it('shrinks with density and stops at a visible size', () => {
    expect(dotRadius(3, 316)).toBe(4.5);
    expect(dotRadius(150, 316)).toBeLessThan(4.5);
    expect(dotRadius(5000, 316)).toBe(2.5);
    expect(dotRadius(0, 316)).toBe(4.5);
  });
});

describe('layoutGraph', () => {
  it('handles a single session on the day it is viewed', () => {
    const layout = layoutGraph(history([{ date: ASOF, kg: 80 }], [dot(ASOF, 80)]), 'yellow', '3M', ASOF);
    layout.lines.forEach(({ d }) => expectInsideGraph(d));
    const [x1, y1, x2, y2] = coordinates(layout.lines[2].d);
    expect(x2).toBeGreaterThan(x1);
    expect(y2).toBe(y1);
    expect(layout.dots).toHaveLength(1);
  });

  it('handles a single session plus its asOf point', () => {
    const points = [
      { date: addDays(ASOF, -3), kg: 80 },
      { date: ASOF, kg: 79.5 },
    ];
    const layout = layoutGraph(history(points, [dot(points[0].date, 80)]), 'yellow', '3M', ASOF);
    layout.lines.forEach(({ d }) => expectInsideGraph(d));
  });

  it('handles every point being identical, with a y span of zero', () => {
    const flat = { lines: { red: [{ date: ASOF, kg: 50 }], yellow: [{ date: ASOF, kg: 50 }], green: [{ date: ASOF, kg: 50 }] }, dots: [dot(ASOF, 50)] };
    const layout = layoutGraph(flat, 'green', 'All', ASOF);
    layout.lines.forEach(({ d }) => expectInsideGraph(d));
    expect(coordinates(layout.lines[0].d)[1]).toBeLessThan(GRAPH_HEIGHT);
  });

  it('keeps drawing when a range holds no sessions, and fits y to what is left', () => {
    const old = addDays(ASOF, -200);
    const points = [
      { date: addDays(ASOF, -300), kg: 40 },
      { date: old, kg: 100 },
      { date: ASOF, kg: 100 },
    ];
    const layout = layoutGraph(history(points, [dot(old, 100)]), 'yellow', '3M', ASOF);
    layout.lines.forEach(({ d }) => expectInsideGraph(d));
    expect(layout.dots).toEqual([]);
    expect(layout.guides.length).toBeGreaterThan(0);
    // y fits 90..110 only, so the old 40 kg does not squash the lines together.
    const yOfFirst = (index: number) => coordinates(layout.lines[index].d)[1];
    expect(Math.abs(yOfFirst(0) - yOfFirst(1))).toBeGreaterThan(30);
  });

  it('keeps the last known value when the history has no asOf point at all', () => {
    const stale = history([{ date: addDays(ASOF, -200), kg: 100 }]);
    const layout = layoutGraph(stale, 'red', '3M', ASOF);
    layout.lines.forEach(({ d }) => expectInsideGraph(d));
  });

  it('paints the current colour last, so an overlapping line never hides it', () => {
    const same = [{ date: addDays(ASOF, -30), kg: 60 }, { date: ASOF, kg: 60 }];
    const overlapping = { lines: { red: same, yellow: same, green: same }, dots: [dot(same[0].date, 60, 'green'), dot(ASOF, 60, 'yellow')] };
    for (const colour of ['red', 'yellow', 'green'] as const) {
      const layout = layoutGraph(overlapping, colour, '3M', ASOF);
      expect(layout.lines[2].colour).toBe(colour);
      expect(new Set(layout.lines.map(({ d }) => d)).size).toBe(1);
    }
    expect(layoutGraph(overlapping, 'green', '3M', ASOF).dots.at(-1)?.colour).toBe('green');
  });

  it('makes dots of the current colour larger than the others', () => {
    const dots = [dot(addDays(ASOF, -10), 90, 'red'), dot(ASOF, 80, 'yellow')];
    const layout = layoutGraph(history([{ date: addDays(ASOF, -10), kg: 80 }, { date: ASOF, kg: 80 }], dots), 'yellow', '3M', ASOF);
    const radius = (colour: Colour) => layout.dots.find((candidate) => candidate.colour === colour)?.r ?? 0;
    expect(radius('yellow')).toBeGreaterThan(radius('red'));
  });

  it('works with negative weights, with higher weight drawn higher', () => {
    const points = [
      { date: addDays(ASOF, -60), kg: -35 },
      { date: addDays(ASOF, -30), kg: -25 },
      { date: ASOF, kg: -12.5 },
    ];
    const layout = layoutGraph(history(points, [dot(points[1].date, -25)]), 'yellow', '3M', ASOF);
    layout.lines.forEach(({ d }) => expectInsideGraph(d));
    const yellow = coordinates(layout.lines[2].d);
    expect(yellow[yellow.length - 1]).toBeLessThan(yellow[1]);
    expect(layout.guides.some(({ label }) => label.startsWith('−'))).toBe(true);
  });

  it('lays out a 3-year log and labels it by month', () => {
    const points = Array.from({ length: 160 }, (_, index) => ({
      date: addDays(ASOF, (index - 159) * 7),
      kg: 60 + index * 0.25 + (index % 5),
    }));
    const dots = points.map((point, index) => dot(point.date, point.kg, index % 3 === 0 ? 'red' : 'yellow'));
    const layout = layoutGraph(history(points, dots), 'yellow', 'All', ASOF);
    layout.lines.forEach(({ d }) => expectInsideGraph(d));
    expect(layout.dots).toHaveLength(160);
    expect(layout.dateLabels).toEqual(['Oct 2023', 'Oct 2026']);
    expect(layout.guides.length).toBeLessThanOrEqual(5);
    for (const { x, y, r } of layout.dots) {
      expect(x - r).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(GRAPH_HEIGHT);
    }
  });

  it('labels a short window by day', () => {
    const layout = layoutGraph(history([{ date: ASOF, kg: 80 }]), 'yellow', '3M', ASOF);
    expect(layout.dateLabels).toEqual(['17 Oct', '31 Oct']);
  });
});
