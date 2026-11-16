import { useMemo, useState } from 'react';
import type { ISODate } from '../domain/types';
import type { StrengthHistory } from '../model';
import './insight.css';
import { GRAPH_HEIGHT, GRAPH_WIDTH, RANGES, type Range, layoutGraph } from './StrengthGraphMath';

export interface StrengthGraphProps {
  history: StrengthHistory;
  asOf: ISODate;
}

/** One yellow 8-rep line with entry dots coloured by their reps, over a chosen range of time. */
export function StrengthGraph({ history, asOf }: StrengthGraphProps) {
  const [range, setRange] = useState<Range>('3M');
  const layout = useMemo(() => layoutGraph(history, range, asOf), [history, range, asOf]);

  return (
    <section className="ins-graph">
      <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} role="img" aria-label="Strength over time">
        {layout.guides.map(({ y, label }) => (
          <g key={label}>
            <line className="ins-guide" x1={layout.guideLeft} x2={layout.guideRight} y1={y} y2={y} />
            <text className="ins-axis" x={GRAPH_WIDTH} y={y + 4} textAnchor="end">
              {label}
            </text>
          </g>
        ))}
        <text className="ins-axis" x={layout.guideLeft} y={layout.axisY}>
          {layout.dateLabels[0]}
        </text>
        <text className="ins-axis" x={layout.guideRight} y={layout.axisY} textAnchor="end">
          {layout.dateLabels[1]}
        </text>
        <path className="ins-line ins-yellow" d={layout.line} />
        {layout.dots.map((dot) => (
          <circle key={dot.entryId} className={`ins-dot ins-${dot.colour}`} cx={dot.x} cy={dot.y} r={dot.r} />
        ))}
      </svg>
      <div className="ins-ranges" role="group" aria-label="Range">
        {RANGES.map((option) => (
          <button
            key={option}
            type="button"
            className="ins-range"
            aria-pressed={option === range}
            onClick={() => setRange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </section>
  );
}
