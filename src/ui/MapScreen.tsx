import { useMemo, useRef, useState } from 'react';
import { useQueries } from '../app/queries';
import { balanceColour, type MuscleDetail } from '../balance';
import { today } from '../domain/date';
import type { ISODate, Muscle } from '../domain/types';
import { setBodyweight } from '../store';
import { BodyMap } from './BodyMap';
import { formatKg, parseKg } from './format';
import './insight.css';
import { MUSCLE_NAMES } from './insightMuscles';

/** Fits two figures across a 390 px wide phone, inside the gutters. */
const FIGURE_HEIGHT = 358;

function Legend() {
  return (
    <div className="ins-legend">
      <div className="ins-legend-bar" />
      <div className="ins-legend-labels">
        <span>Lagging</span>
        <span>In proportion</span>
        <span>Ahead</span>
      </div>
    </div>
  );
}

function Detail({ muscle, detail }: { muscle: Muscle; detail: MuscleDetail | null }) {
  const name = MUSCLE_NAMES[muscle];
  if (!detail) {
    return (
      <section className="ins-detail" aria-label={name}>
        <h2 className="ins-detail-name">{name}</h2>
        <p className="ins-line-text">No data for this muscle yet.</p>
      </section>
    );
  }
  return (
    <section className="ins-detail" aria-label={name}>
      <h2 className="ins-detail-name">{name}</h2>
      <p className="ins-detail-level">
        {detail.levelName} {detail.level.toFixed(1)}
      </p>
      <p className="ins-detail-average">Your average {detail.average.toFixed(1)}</p>
      <ul className="ins-lifts">
        {detail.lifts.map((lift) => (
          <li key={lift.exerciseId} className="ins-lift">
            <span>{lift.name}</span>
            <span>{formatKg(Math.round(lift.oneRepMaxKg))} kg</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BodyweightInput({ date }: { date: ISODate }) {
  const [text, setText] = useState('');
  const saved = useRef(false);

  const save = () => {
    const kg = parseKg(text);
    if (saved.current || kg === null || kg <= 0) return;
    saved.current = true;
    setBodyweight(date, kg).catch((error: unknown) => {
      saved.current = false;
      console.error('fitNotes: could not save bodyweight', error);
    });
  };

  return (
    <form
      className="ins-bodyweight"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label htmlFor="ins-bodyweight">Bodyweight</label>
      <input
        id="ins-bodyweight"
        className="ins-bodyweight-input"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={({ target }) => setText(target.value)}
        onBlur={save}
      />
      <span>kg</span>
      <button className="ins-bodyweight-save" type="submit">
        Save
      </button>
    </form>
  );
}

export function MapScreen() {
  const queries = useQueries();
  const [selected, setSelected] = useState<Muscle | null>(null);
  const date = today();

  const balance = useMemo(() => queries?.muscleBalance(date), [queries, date]);
  const fills = useMemo(() => {
    if (!balance) return {};
    const scores = Object.entries(balance) as [Muscle, number | null][];
    return Object.fromEntries(scores.map(([muscle, score]) => [muscle, balanceColour(score)]));
  }, [balance]);

  if (!queries || !balance) return null;

  const hasData = Object.values(balance).some((score) => score !== null);

  return (
    <div className="ins-screen">
      <header className="ins-map-title">
        <h1 className="ins-title">Muscle map</h1>
      </header>
      <div className="ins-map-figure">
        <BodyMap fills={fills} onMuscle={setSelected} height={FIGURE_HEIGHT} />
      </div>
      {hasData ? <Legend /> : <p className="ins-line-text">Log a lift like bench press or squat to fill the map.</p>}
      {selected && <Detail muscle={selected} detail={queries.muscleDetail(selected, date)} />}
      {queries.bodyweightKg(date) === null && <BodyweightInput date={date} />}
    </div>
  );
}
