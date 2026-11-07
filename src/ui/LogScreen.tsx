import { type FocusEvent, type ReactNode, type SubmitEvent, useReducer, useState } from 'react';
import type { Queries } from '../app/queries';
import { today } from '../domain/date';
import type { Entry, Exercise } from '../domain/types';
import { gridStep } from '../model';
import { addEntry, deleteEntry, setBodyweight, updateEntry } from '../store';
import { formatKg } from './format';
import { MinusIcon, PlusIcon } from './icons';
import {
  editLogForm,
  isAssistance,
  logFormReducer,
  needsBodyweight,
  newLogForm,
  submission,
  weightFloor,
} from './logForm';
import { go, href } from './nav';

/** Leaves no doubt about which weight to enter. */
function weightLabel({ equipment, perHand }: Exercise): string {
  if (equipment === 'bodyweight') return 'Added weight';
  return perHand ? 'Per hand' : 'Weight';
}

function Stepper({
  name,
  onStep,
  children,
}: {
  name: string;
  onStep: (direction: 1 | -1) => void;
  children: ReactNode;
}) {
  return (
    <div className="stepper">
      <button type="button" aria-label={`Less ${name}`} onClick={() => onStep(-1)}>
        <MinusIcon size={28} />
      </button>
      {children}
      <button type="button" aria-label={`More ${name}`} onClick={() => onStep(1)}>
        <PlusIcon size={28} />
      </button>
    </div>
  );
}

function selectAll(event: FocusEvent<HTMLInputElement>) {
  event.currentTarget.select();
}

function LogForm({ queries, exercise, entry }: { queries: Queries; exercise: Exercise; entry?: Entry }) {
  const date = today();
  const [state, dispatch] = useReducer(logFormReducer, undefined, () =>
    entry ? editLogForm(entry) : newLogForm(exercise.colour, date, queries.predict(exercise.id, date)),
  );
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [failed, setFailed] = useState(false);

  const { id: exerciseId, equipment } = exercise;
  const isBodyweight = equipment === 'bodyweight';
  const context = {
    equipment,
    bodyweightShare: exercise.bodyweightShare ?? 1,
    bodyweightKg: queries.bodyweightKg(state.date),
    today: date,
  };
  const result = submission(state, context);
  const floor = weightFloor(context, context.bodyweightKg);

  /** Runs one write, then leaves. A second tap while it runs does nothing. */
  async function finish(write: () => Promise<void>) {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await write();
      go({ name: 'exercise', exerciseId });
    } catch (error) {
      console.error('fitNotes: could not save', error);
      setFailed(true);
      setSaving(false);
    }
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (!result) return;
    const { date: entryDate, weightKg, reps, bodyweightKg } = result;
    void finish(async () => {
      if (bodyweightKg !== null) await setBodyweight(entryDate, bodyweightKg);
      if (entry) await updateEntry(entry.id, { date: entryDate, weightKg, reps });
      else await addEntry({ exerciseId, date: entryDate, weightKg, reps });
    });
  }

  function remove() {
    if (!entry) return;
    if (!confirmingDelete) setConfirmingDelete(true);
    else void finish(() => deleteEntry(entry.id));
  }

  return (
    <form className="screen log" data-colour={state.colour} onSubmit={save}>
      <a className="log-title" href={href({ name: 'exercise', exerciseId })}>
        {exercise.name}
      </a>

      {isBodyweight && context.bodyweightKg !== null && (
        <div className="log-line">
          <span id="log-bodyweight-label">Bodyweight</span>
          <output className="log-bodyweight" aria-labelledby="log-bodyweight-label">
            {formatKg(context.bodyweightKg)} kg
          </output>
        </div>
      )}
      {needsBodyweight(context) && (
        <div className="log-line">
          <label htmlFor="log-bodyweight">Bodyweight</label>
          <input
            id="log-bodyweight"
            inputMode="decimal"
            autoComplete="off"
            value={state.bodyweightText}
            onChange={(event) => dispatch({ type: 'bodyweight', text: event.target.value })}
          />
        </div>
      )}

      <div className="log-label">
        <label htmlFor="log-weight">{weightLabel(exercise)}</label>
        {isBodyweight && isAssistance(state) && <span className="assistance">Assistance</span>}
      </div>
      <Stepper
        name="weight"
        onStep={(direction) => dispatch({ type: 'stepWeight', delta: direction * gridStep(equipment), floor })}
      >
        {/* The iOS decimal pad has no minus, so added weight takes the full keyboard. */}
        <input
          id="log-weight"
          className="log-weight"
          inputMode={isBodyweight ? 'text' : 'decimal'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={state.weightText}
          onChange={(event) => dispatch({ type: 'weight', text: event.target.value })}
          onFocus={selectAll}
        />
      </Stepper>

      <div className="log-label">
        <label htmlFor="log-reps">Reps</label>
      </div>
      <Stepper name="reps" onStep={(direction) => dispatch({ type: 'stepReps', delta: direction })}>
        <input
          id="log-reps"
          className="log-reps"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={state.repsText}
          onChange={(event) => dispatch({ type: 'reps', text: event.target.value })}
          onFocus={selectAll}
        />
      </Stepper>

      <div className="log-line">
        <label htmlFor="log-date">Date</label>
        <input
          id="log-date"
          type="date"
          max={date}
          value={state.date}
          onChange={({ target: { value } }) =>
            dispatch({ type: 'date', date: value, prediction: value ? queries.predict(exerciseId, value) : null })
          }
        />
      </div>

      {failed && <p className="error">Could not save. Try again.</p>}
      <button type="submit" className="save" disabled={!result || saving}>
        Save
      </button>
      {entry && (
        <button type="button" className="quiet" disabled={saving} onClick={remove}>
          {confirmingDelete ? 'Tap again to delete' : 'Delete'}
        </button>
      )}
    </form>
  );
}

export function LogScreen({
  queries,
  exerciseId,
  entryId,
}: {
  queries: Queries;
  exerciseId: string;
  entryId?: string;
}) {
  const exercise = queries.exercise(exerciseId);
  const entry = queries.entries(exerciseId).find(({ id }) => id === entryId);
  // A deleted entry drops out for a moment before the route moves on.
  if (!exercise || (entryId && !entry)) return null;
  return <LogForm queries={queries} exercise={exercise} entry={entry} />;
}
