import { memo, useMemo } from 'react';
import Model, { type IExerciseData, type IMuscleStats } from 'react-body-highlighter';
import type { Muscle } from '../domain/types';
import { isMuscle } from './insightMuscles';
import './insight.css';

const BODY_COLOUR = '#3a3a3c';
const DEFAULT_HEIGHT = 160;
/** The hands reach the edge of each figure, so the two need a little air, as a share of height. */
const FIGURE_GAP = 0.05;

export interface BodyMapProps {
  /** CSS colour per muscle. Muscles left out show as the plain body colour. */
  fills: Partial<Record<Muscle, string>>;
  onMuscle?: (muscle: Muscle) => void;
  /** Height in px of each figure. */
  height?: number;
}

/**
 * The library colours a muscle with `colours[frequency - 1]` and sums frequency
 * across rows, so one row per muscle turns frequency into a palette index.
 */
export function highlightFor(fills: BodyMapProps['fills']): { colours: string[]; rows: IExerciseData[] } {
  const filled = (Object.entries(fills) as [Muscle, string | undefined][]).flatMap(([muscle, colour]) =>
    colour ? [{ muscle, colour }] : [],
  );
  const colours = [...new Set(filled.map(({ colour }) => colour))];
  const rows = filled.map(({ muscle, colour }) => ({
    name: muscle,
    muscles: [muscle],
    frequency: colours.indexOf(colour) + 1,
  }));
  return { colours, rows };
}

function sameFills(a: BodyMapProps['fills'], b: BodyMapProps['fills']): boolean {
  const muscles = Object.keys(a) as Muscle[];
  return muscles.length === Object.keys(b).length && muscles.every((muscle) => a[muscle] === b[muscle]);
}

/**
 * Front and back figures side by side. Compares `fills` by content, because lists
 * mount many of these and tend to build the object inline.
 */
export const BodyMap = memo(
  function BodyMap({ fills, onMuscle, height = DEFAULT_HEIGHT }: BodyMapProps) {
    const { colours, rows } = useMemo(() => highlightFor(fills), [fills]);
    const onClick = useMemo(
      () =>
        onMuscle &&
        (({ muscle }: IMuscleStats) => {
          if (isMuscle(muscle)) onMuscle(muscle);
        }),
      [onMuscle],
    );
    const shared = { data: rows, highlightedColors: colours, bodyColor: BODY_COLOUR, onClick };

    return (
      <div
        className={onMuscle ? 'ins-body ins-body--tap' : 'ins-body'}
        style={{ width: height * (1 + FIGURE_GAP), gap: height * FIGURE_GAP }}
      >
        <Model type="anterior" {...shared} />
        <Model type="posterior" {...shared} />
      </div>
    );
  },
  (a, b) => a.height === b.height && a.onMuscle === b.onMuscle && sameFills(a.fills, b.fills),
);
