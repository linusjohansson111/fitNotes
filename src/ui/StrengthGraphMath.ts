import { COLOURS } from '../domain/colour';
import { addDays, daysBetween } from '../domain/date';
import type { Colour, ISODate } from '../domain/types';
import type { StrengthDot, StrengthHistory, StrengthPoint } from '../model';
import { formatKg } from './format';
import { monthYear, shortDate } from './insightFormat';

export type Range = '3M' | '1Y' | 'All';

export const RANGES: readonly Range[] = ['3M', '1Y', 'All'];

/** Size of the SVG's coordinate system. It scales to the width of the screen. */
export const GRAPH_WIDTH = 358;
export const GRAPH_HEIGHT = 196;

/** Room for the largest dot at the edges, and for the labels on the right and below. */
const PLOT = { left: 6, right: 322, top: 8, bottom: 172 };

const RANGE_DAYS = { '3M': 91, '1Y': 365 };
/** A short log still gets a readable x axis. This also covers a log of a single day. */
const MIN_SPAN_DAYS = 14;
/** Past this span, a date label names the month rather than the day. */
const MONTH_LABELS_FROM_DAYS = 200;
const Y_PADDING_SHARE = 0.12;
/** Keeps a span of zero drawable, and keeps tiny changes from filling the graph. */
const MIN_Y_PADDING_KG = 1;
const MAX_DOT_RADIUS = 4.5;
const MIN_DOT_RADIUS = 2.5;
const OTHER_DOT_SHARE = 0.67;

export interface GraphLine {
  colour: Colour;
  /** SVG path data. */
  d: string;
}

export interface GraphDot {
  entryId: string;
  colour: Colour;
  x: number;
  y: number;
  r: number;
}

export interface GraphGuide {
  y: number;
  label: string;
}

export interface GraphLayout {
  /** Other colours first, so the current colour stays on top where lines overlap. */
  lines: GraphLine[];
  /** Same order as `lines`. */
  dots: GraphDot[];
  guides: GraphGuide[];
  guideLeft: number;
  guideRight: number;
  axisY: number;
  dateLabels: [string, string];
}

/** The dates on show: the range, narrowed to the log, widened to a readable span. */
export function visibleWindow(
  history: StrengthHistory,
  range: Range,
  asOf: ISODate,
): { from: ISODate; to: ISODate } {
  const dated = [...COLOURS.flatMap((colour) => history.lines[colour]), ...history.dots];
  const earliest = dated.reduce((first, { date }) => (date < first ? date : first), asOf);
  const limit = range === 'All' ? earliest : addDays(asOf, -RANGE_DAYS[range]);
  const from = earliest > limit ? earliest : limit;
  return { from: daysBetween(from, asOf) < MIN_SPAN_DAYS ? addDays(asOf, -MIN_SPAN_DAYS) : from, to: asOf };
}

/** Straight between known points, and the nearest known value beyond them. */
export function valueAt(points: StrengthPoint[], date: ISODate): number {
  const next = points.findIndex((point) => point.date >= date);
  if (next === 0) return points[0].kg;
  if (next === -1) return points[points.length - 1].kg;
  const [before, after] = [points[next - 1], points[next]];
  return before.kg + ((after.kg - before.kg) * daysBetween(before.date, date)) / daysBetween(before.date, after.date);
}

/**
 * The line within `from`..`to`, always reaching both ends, so a range holding no
 * points still draws the last known value. On a repeated date the later point wins.
 */
export function clipLine(points: StrengthPoint[], from: ISODate, to: ISODate): StrengthPoint[] {
  if (points.length === 0) return [];
  const unique = [...new Map(points.map(({ date, kg }) => [date, kg]))].map(([date, kg]) => ({ date, kg }));
  const inside = unique.filter(({ date }) => date > from && date < to);
  return [{ date: from, kg: valueAt(unique, from) }, ...inside, { date: to, kg: valueAt(unique, to) }];
}

/** Fits the values with some padding. Never forced to zero, and never a span of zero. */
export function yDomain(values: number[]): [number, number] {
  if (values.length === 0) return [-MIN_Y_PADDING_KG, MIN_Y_PADDING_KG];
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const padding = Math.max((high - low) * Y_PADDING_SHARE, MIN_Y_PADDING_KG);
  return [low - padding, high + padding];
}

/** Round weights inside the domain, for two or three light guides. */
export function yTicks(low: number, high: number): number[] {
  const rough = (high - low) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((share) => share * magnitude).find((value) => value > rough) as number;
  const ticks: number[] = [];
  for (let index = Math.ceil(low / step); index * step <= high; index += 1) {
    ticks.push(Number((index * step).toFixed(6)) + 0); // + 0 turns -0 into 0
  }
  return ticks;
}

/** Dots shrink as a long log packs them together, down to a size still seen. */
export function dotRadius(count: number, plotWidth: number): number {
  return Math.min(MAX_DOT_RADIUS, Math.max(MIN_DOT_RADIUS, (plotWidth / Math.max(count, 1)) * 0.4));
}

function coordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

function path(points: { x: number; y: number }[]): string {
  return points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${coordinate(x)} ${coordinate(y)}`).join('');
}

function currentLast(colour: Colour): Colour[] {
  return [...COLOURS.filter((other) => other !== colour), colour];
}

export function layoutGraph(
  history: StrengthHistory,
  current: Colour,
  range: Range,
  asOf: ISODate,
): GraphLayout {
  const { from, to } = visibleWindow(history, range, asOf);
  const clipped = currentLast(current).map((colour) => ({
    colour,
    points: clipLine(history.lines[colour], from, to),
  }));
  const shown: StrengthDot[] = history.dots.filter(({ date }) => date >= from && date <= to);
  const [low, high] = yDomain([
    ...clipped.flatMap(({ points }) => points.map(({ kg }) => kg)),
    ...shown.map(({ kg }) => kg),
  ]);

  const days = daysBetween(from, to);
  const width = PLOT.right - PLOT.left;
  const xOf = (date: ISODate) => PLOT.left + (daysBetween(from, date) / days) * width;
  const yOf = (kg: number) => PLOT.bottom - ((kg - low) / (high - low)) * (PLOT.bottom - PLOT.top);

  const lines = clipped.map(({ colour, points }) => ({
    colour,
    d: path(points.map(({ date, kg }) => ({ x: xOf(date), y: yOf(kg) }))),
  }));

  const radius = dotRadius(shown.filter(({ colour }) => colour === current).length, width);
  const dots = currentLast(current).flatMap((colour) =>
    shown
      .filter((dot) => dot.colour === colour)
      .map(({ entryId, date, kg }) => ({
        entryId,
        colour,
        x: coordinate(xOf(date)),
        y: coordinate(yOf(kg)),
        r: colour === current ? radius : radius * OTHER_DOT_SHARE,
      })),
  );

  const dateLabel = (date: ISODate) => (days >= MONTH_LABELS_FROM_DAYS ? monthYear(date) : shortDate(date, to));

  return {
    lines,
    dots,
    guides: yTicks(low, high).map((kg) => ({ y: coordinate(yOf(kg)), label: formatKg(kg) })),
    guideLeft: PLOT.left,
    guideRight: PLOT.right,
    axisY: GRAPH_HEIGHT - 6,
    dateLabels: [dateLabel(from), dateLabel(to)],
  };
}
