import { TARGET_REPS, colourForReps } from '../domain/colour';
import type { Colour, Entry, Equipment, ISODate, Prediction } from '../domain/types';
import { formatKg, parseKg } from './format';

export interface LogFormState {
  date: ISODate;
  repsText: string;
  weightText: string;
  /** Only used when a bodyweight exercise has no bodyweight to work from. */
  bodyweightText: string;
  colour: Colour;
  /** Typed, stepped or loaded from an entry: reps and date no longer replace it. */
  weightEdited: boolean;
  /** For `date`. Null while the exercise has no entry to predict from. */
  prediction: Prediction | null;
}

export type LogFormAction =
  | { type: 'weight'; text: string }
  /** `floor` comes from `weightFloor`; a step that would reach it is ignored. */
  | { type: 'stepWeight'; delta: number; floor: number }
  | { type: 'reps'; text: string }
  | { type: 'stepReps'; delta: number }
  /** `prediction` is the one for the new date. */
  | { type: 'date'; date: ISODate; prediction: Prediction | null }
  | { type: 'bodyweight'; text: string };

export interface LogFormContext {
  equipment: Equipment;
  /** Bodyweight rows: the share of bodyweight a rep moves. */
  bodyweightShare: number;
  /** Known bodyweight, or null when none has ever been recorded. */
  bodyweightKg: number | null;
  today: ISODate;
}

export interface LogSubmission {
  date: ISODate;
  weightKg: number;
  reps: number;
  /** Typed into the form, to be saved with the entry. Null when none was needed. */
  bodyweightKg: number | null;
}

function predictedText(prediction: Prediction | null, colour: Colour): string {
  return prediction ? formatKg(prediction[colour]) : '';
}

/** A log of a new set, on the exercise's colour. `prediction` is null for a new exercise. */
export function newLogForm(colour: Colour, date: ISODate, prediction: Prediction | null): LogFormState {
  return {
    date,
    repsText: String(TARGET_REPS[colour]),
    weightText: predictedText(prediction, colour),
    bodyweightText: '',
    colour,
    weightEdited: false,
    prediction,
  };
}

/** An existing entry, whose weight the user chose and so counts as edited. */
export function editLogForm(entry: Entry): LogFormState {
  return {
    date: entry.date,
    repsText: String(entry.reps),
    weightText: formatKg(entry.weightKg),
    bodyweightText: '',
    colour: colourForReps(entry.reps),
    weightEdited: true,
    prediction: null,
  };
}

/** Whole reps from 1, else null. */
export function parseReps(text: string): number | null {
  const reps = /^\d+$/.test(text.trim()) ? Number(text) : 0;
  return reps >= 1 ? reps : null;
}

/** A negative added weight on a bodyweight row: the machine or band takes some off. */
export function isAssistance(state: LogFormState): boolean {
  return /^\s*[-−]/.test(state.weightText);
}

/** A weight must be above this. It matches where the model stops seeing any load. */
export function weightFloor(
  { equipment, bodyweightShare }: Pick<LogFormContext, 'equipment' | 'bodyweightShare'>,
  bodyweightKg: number | null,
): number {
  if (equipment !== 'bodyweight') return 0;
  return bodyweightKg === null ? Number.NEGATIVE_INFINITY : -bodyweightShare * bodyweightKg;
}

/** The form has to ask, because the model would otherwise assume 80 kg. */
export function needsBodyweight({ equipment, bodyweightKg }: LogFormContext): boolean {
  return equipment === 'bodyweight' && bodyweightKg === null;
}

function followPrediction(state: LogFormState): LogFormState {
  if (state.weightEdited) return state;
  return { ...state, weightText: predictedText(state.prediction, state.colour) };
}

function withReps(state: LogFormState, repsText: string): LogFormState {
  const reps = parseReps(repsText);
  if (reps === null) return { ...state, repsText };
  return followPrediction({ ...state, repsText, colour: colourForReps(reps) });
}

function editedWeight(state: LogFormState, weightText: string): LogFormState {
  return { ...state, weightText, weightEdited: true };
}

export function logFormReducer(state: LogFormState, action: LogFormAction): LogFormState {
  switch (action.type) {
    case 'weight':
      return editedWeight(state, action.text);
    case 'stepWeight': {
      const next = (parseKg(state.weightText) ?? 0) + action.delta;
      return next > action.floor ? editedWeight(state, formatKg(next)) : state;
    }
    case 'reps':
      return withReps(state, action.text);
    case 'stepReps':
      return withReps(state, String(Math.max(1, (parseReps(state.repsText) ?? 0) + action.delta)));
    case 'date':
      // iOS offers a Reset button in its date picker; a form needs a date.
      if (!action.date) return state;
      return followPrediction({ ...state, date: action.date, prediction: action.prediction });
    case 'bodyweight':
      return { ...state, bodyweightText: action.text };
  }
}

/** What to save, or null while the form is not valid. */
export function submission(state: LogFormState, context: LogFormContext): LogSubmission | null {
  const weightKg = parseKg(state.weightText);
  const reps = parseReps(state.repsText);
  const typedBodyweight = needsBodyweight(context) ? parseKg(state.bodyweightText) : null;

  if (weightKg === null || reps === null) return null;
  // iOS date pickers do not always honour `max`.
  if (state.date > context.today) return null;
  if (needsBodyweight(context) && (typedBodyweight === null || typedBodyweight <= 0)) return null;
  if (weightKg <= weightFloor(context, context.bodyweightKg ?? typedBodyweight)) return null;

  // Adding 0 turns a typed "−0" into plain 0.
  return { date: state.date, weightKg: weightKg + 0, reps, bodyweightKg: typedBodyweight };
}
