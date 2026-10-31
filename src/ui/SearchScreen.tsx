import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Queries } from '../app/queries';
import { searchExercises } from '../data';
import type { ExerciseDef } from '../domain/types';
import { BodyMap } from './BodyMap';
import { muscleFills } from './muscles';
import { href } from './nav';

const RESULT_LIMIT = 40;
const MAP_HEIGHT = 56;
/** Start drawing a little before a row scrolls in, so it is ready when it arrives. */
const MAP_MARGIN = '200px';

/** Mounts the map once its row nears the screen: dozens of SVG figures would make typing lag. */
function RowMap({ exercise }: { exercise: ExerciseDef }) {
  const slot = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (visible || !slot.current) return;
    const observer = new IntersectionObserver(
      (changes) => {
        if (changes.some((change) => change.isIntersecting)) setVisible(true);
      },
      { rootMargin: MAP_MARGIN },
    );
    observer.observe(slot.current);
    return () => observer.disconnect();
  }, [visible]);

  const fills = useMemo(
    () => muscleFills(exercise.primaryMuscles, exercise.secondaryMuscles),
    [exercise],
  );

  return (
    <div className="result-map" ref={slot}>
      {visible && <BodyMap fills={fills} height={MAP_HEIGHT} />}
    </div>
  );
}

/** Memoised so that a keystroke rerenders only the input until the deferred query catches up. */
const Results = memo(function Results({ results }: { results: ExerciseDef[] }) {
  return (
    <ul className="rows">
      {results.map((exercise) => (
        <li key={exercise.id}>
          <a className="result" href={href({ name: 'log', exerciseId: exercise.id })}>
            <span className="result-name">{exercise.name}</span>
            <RowMap exercise={exercise} />
          </a>
        </li>
      ))}
    </ul>
  );
});

export function SearchScreen({ queries }: { queries: Queries }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(
    () => searchExercises(deferredQuery, queries.exercises, RESULT_LIMIT),
    [deferredQuery, queries.exercises],
  );
  const typed = query.trim();

  return (
    <div className="screen">
      <input
        className="search"
        type="search"
        placeholder="Search exercises"
        aria-label="Search exercises"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Results results={results} />
      <a className="quiet" href={href(typed ? { name: 'custom', initialName: typed } : { name: 'custom' })}>
        {typed ? `Add “${typed}” as a custom exercise` : 'Add a custom exercise'}
      </a>
    </div>
  );
}
