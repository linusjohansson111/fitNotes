import { useEffect, useRef, useState } from 'react';
import { useQueries } from '../app/queries';
import { COLOURS, TARGET_REPS, colourForReps } from '../domain/colour';
import { today } from '../domain/date';
import type { Colour, Entry, Prediction } from '../domain/types';
import { setNote } from '../store';
import { formatKg } from './format';
import './insight.css';
import { shortDate, sinceLabel } from './insightFormat';
import { href } from './nav';
import { StrengthGraph } from './StrengthGraph';

function Weights({ prediction, current }: { prediction: Prediction; current: Colour }) {
  return (
    <div className="ins-weights">
      {COLOURS.map((colour) => (
        <div
          key={colour}
          className={`ins-weight ins-${colour}${colour === current ? ' ins-weight--now' : ''}`}
          data-colour={colour}
        >
          <span className="ins-weight-kg">{formatKg(prediction[colour])}</span>
          <span className="ins-weight-reps">kg × {TARGET_REPS[colour]}</span>
        </div>
      ))}
    </div>
  );
}

/** Saves on blur, on leaving the screen, and when the app goes to the background. */
function Note({ exerciseId, note }: { exerciseId: string; note: string }) {
  const [text, setText] = useState(note);
  const draft = useRef(note);
  const saved = useRef(note);

  const save = useRef(() => {
    if (draft.current === saved.current) return;
    saved.current = draft.current;
    setNote(exerciseId, draft.current).catch((error: unknown) => {
      console.error('fitNotes: could not save the note', error);
    });
  }).current;

  useEffect(() => {
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', saveWhenHidden);
    return () => {
      document.removeEventListener('visibilitychange', saveWhenHidden);
      save();
    };
  }, [save]);

  return (
    <textarea
      className="ins-note"
      aria-label="Note"
      placeholder="Note"
      rows={2}
      value={text}
      onChange={({ target }) => {
        draft.current = target.value;
        setText(target.value);
      }}
      onBlur={save}
    />
  );
}

function History({ exerciseId, entries, asOf }: { exerciseId: string; entries: Entry[]; asOf: string }) {
  return (
    <ol className="ins-history" aria-label="History">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a className="ins-entry" href={href({ name: 'log', exerciseId, entryId: entry.id })}>
            <span className="ins-entry-date">{shortDate(entry.date, asOf)}</span>
            <span>
              {formatKg(entry.weightKg)} kg × {entry.reps}
            </span>
            <span className={`ins-swatch ins-${colourForReps(entry.reps)}`} data-colour={colourForReps(entry.reps)} />
          </a>
        </li>
      ))}
    </ol>
  );
}

export function ExerciseScreen({ exerciseId }: { exerciseId: string }) {
  const queries = useQueries();
  if (!queries) return null;

  const exercise = queries.exercise(exerciseId);
  if (!exercise) {
    return (
      <div className="ins-screen">
        <p className="ins-line-text">This exercise no longer exists.</p>
        <a className="ins-link" href={href({ name: 'home' })}>
          Home
        </a>
      </div>
    );
  }

  const date = today();
  const entries = queries.entries(exerciseId);
  const prediction = queries.predict(exerciseId, date);
  const history = queries.strengthHistory(exerciseId, date);
  const last = entries.at(0);

  return (
    <div className="ins-screen">
      <header className="ins-header">
        <a className="ins-back" href={href({ name: 'home' })} aria-label="Home">
          <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true">
            <path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <h1 className="ins-title">{exercise.name}</h1>
      </header>

      {prediction && <Weights prediction={prediction} current={exercise.colour} />}

      <a
        className={`ins-log ins-${exercise.colour}`}
        href={href({ name: 'log', exerciseId })}
      >
        Log
      </a>

      {prediction && <StrengthGraph history={history} colour={exercise.colour} asOf={date} />}

      {last && (
        <p className="ins-last">
          Last {formatKg(last.weightKg)} kg × {last.reps} · {sinceLabel(last.date, date)}
        </p>
      )}

      <Note key={exerciseId} exerciseId={exerciseId} note={exercise.note} />

      {entries.length > 0 && <History exerciseId={exerciseId} entries={entries} asOf={date} />}
    </div>
  );
}
