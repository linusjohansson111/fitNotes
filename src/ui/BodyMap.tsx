import { memo } from 'react';
import type { Muscle } from '../domain/types';
import { BACK, type BodyPolygon, FRONT } from './bodyShapes';
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

function Figure({ polygons, fills, onMuscle }: { polygons: BodyPolygon[] } & BodyMapProps) {
  return (
    <svg className="ins-figure" viewBox="0 0 100 200">
      {polygons.map(({ muscle, points }, index) => (
        <polygon
          key={index}
          points={points}
          style={{ fill: (muscle && fills[muscle]) || BODY_COLOUR }}
          onClick={muscle && onMuscle ? () => onMuscle(muscle) : undefined}
        />
      ))}
    </svg>
  );
}

/** Whether two props would draw the same map. Compares `fills` by content, because lists build it inline. */
export function sameMap(a: BodyMapProps, b: BodyMapProps): boolean {
  const muscles = Object.keys(a.fills) as Muscle[];
  return (
    a.height === b.height &&
    a.onMuscle === b.onMuscle &&
    muscles.length === Object.keys(b.fills).length &&
    muscles.every((muscle) => a.fills[muscle] === b.fills[muscle])
  );
}

/** Front and back figures side by side. */
export const BodyMap = memo(function BodyMap({ fills, onMuscle, height = DEFAULT_HEIGHT }: BodyMapProps) {
  return (
    <div
      className={onMuscle ? 'ins-body ins-body--tap' : 'ins-body'}
      style={{ width: height * (1 + FIGURE_GAP), gap: height * FIGURE_GAP }}
    >
      <Figure polygons={FRONT} fills={fills} onMuscle={onMuscle} />
      <Figure polygons={BACK} fills={fills} onMuscle={onMuscle} />
    </div>
  );
}, sameMap);
