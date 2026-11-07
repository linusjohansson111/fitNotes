import { describe, expect, it } from 'vitest';
import type { Colour, Entry, Prediction } from '../domain/types';
import {
  type LogFormAction,
  type LogFormContext,
  type LogFormState,
  editLogForm,
  isAssistance,
  logFormReducer,
  needsBodyweight,
  newLogForm,
  parseReps,
  submission,
  weightFloor,
} from './logForm';

const TODAY = '2026-03-10';
const PREDICTION: Prediction = { red: 90, yellow: 80, green: 70 };
const LATER: Prediction = { red: 85, yellow: 75, green: 65 };
const BARBELL: LogFormContext = { equipment: 'barbell', bodyweightShare: 1, bodyweightKg: null, today: TODAY };
const BODYWEIGHT: LogFormContext = { equipment: 'bodyweight', bodyweightShare: 1, bodyweightKg: 80, today: TODAY };

const COLOUR_OF_REPS: Record<number, Colour> = {
  3: 'red',
  5: 'red',
  6: 'red',
  7: 'yellow',
  8: 'yellow',
  9: 'yellow',
  10: 'green',
  11: 'green',
  12: 'green',
};

function run(state: LogFormState, ...actions: LogFormAction[]): LogFormState {
  return actions.reduce(logFormReducer, state);
}

function opened(colour: Colour, prediction: Prediction | null = PREDICTION): LogFormState {
  return newLogForm(colour, TODAY, prediction);
}

/** A form sitting at `reps`, weight untouched. */
function atReps(reps: number, prediction: Prediction | null = PREDICTION): LogFormState {
  return run(opened(COLOUR_OF_REPS[reps], prediction), { type: 'reps', text: String(reps) });
}

const entry: Entry = {
  id: 'e1',
  exerciseId: 'bench',
  date: '2026-03-01',
  weightKg: 82.5,
  reps: 4,
  updatedAt: 1,
};

describe('AC5: opening the form', () => {
  it.each<[Colour, number, string]>([
    ['red', 5, '90'],
    ['yellow', 8, '80'],
    ['green', 11, '70'],
  ])('starts on %s with its target reps and predicted weight', (colour, reps, weight) => {
    const state = opened(colour);
    expect(state).toMatchObject({ colour, repsText: String(reps), weightText: weight, date: TODAY });
    expect(state.weightEdited).toBe(false);
  });

  it('starts a new exercise yellow, 8 reps, blank weight', () => {
    const state = opened('yellow', null);
    expect(state).toMatchObject({ colour: 'yellow', repsText: '8', weightText: '' });
  });

  it('AC9: a latest entry of 4 reps still opens on red at 5 reps', () => {
    expect(opened('red')).toMatchObject({ repsText: '5', weightText: '90' });
  });

  it('shows a negative prediction with a real minus sign', () => {
    const state = opened('red', { red: -12.5, yellow: -20, green: -27.5 });
    expect(state.weightText).toBe('−12.5');
    expect(isAssistance(state)).toBe(true);
  });
});

describe('AC6: reps crossing a colour boundary', () => {
  const crossings: [from: number, to: number][] = [
    [6, 7],
    [7, 6],
    [9, 10],
    [10, 9],
    [6, 10],
    [10, 6],
    [3, 12],
    [12, 3],
    [5, 11],
    [11, 5],
  ];

  describe.each(crossings)('from %i to %i', (from, to) => {
    const colour = COLOUR_OF_REPS[to];

    it('switches colour and takes the prediction when the weight is untouched', () => {
      const state = run(atReps(from), { type: 'reps', text: String(to) });
      expect(state.colour).toBe(colour);
      expect(state.weightText).toBe(String(PREDICTION[colour]));
      expect(state.weightEdited).toBe(false);
    });

    it('switches colour and keeps a typed weight', () => {
      const state = run(
        atReps(from),
        { type: 'weight', text: '77' },
        { type: 'reps', text: String(to) },
      );
      expect(state.colour).toBe(colour);
      expect(state.weightText).toBe('77');
    });

    it('switches colour and stays blank without a prediction', () => {
      const state = run(atReps(from, null), { type: 'reps', text: String(to) });
      expect(state.colour).toBe(colour);
      expect(state.weightText).toBe('');
    });
  });

  it.each([
    [6, 1, 'yellow'],
    [7, -1, 'red'],
    [9, 1, 'green'],
    [10, -1, 'yellow'],
  ] as const)('stepping from %i by %i switches to %s', (from, delta, colour) => {
    const state = run(atReps(from), { type: 'stepReps', delta });
    expect(state.colour).toBe(colour);
    expect(state.repsText).toBe(String(from + delta));
    expect(state.weightText).toBe(String(PREDICTION[colour]));
  });

  it.each([
    [5, 6],
    [6, 5],
    [7, 9],
    [9, 7],
    [10, 11],
    [11, 10],
  ])('stays on the same colour from %i to %i', (from, to) => {
    const before = atReps(from);
    const state = run(before, { type: 'reps', text: String(to) });
    expect(state.colour).toBe(before.colour);
    expect(state.weightText).toBe(before.weightText);
  });

  it('keeps a stepped weight across a crossing', () => {
    const state = run(
      atReps(6),
      { type: 'stepWeight', delta: 2.5, floor: 0 },
      { type: 'reps', text: '7' },
    );
    expect(state).toMatchObject({ colour: 'yellow', weightText: '92.5' });
  });

  it('returns to the prediction when reps cross back over an untouched weight', () => {
    const state = run(atReps(6), { type: 'reps', text: '7' }, { type: 'reps', text: '6' });
    expect(state).toMatchObject({ colour: 'red', weightText: '90' });
  });

  it('keeps the last colour while reps are blank or invalid, and catches up after', () => {
    for (const text of ['', '0', 'x', '8.5']) {
      expect(run(atReps(8), { type: 'reps', text })).toMatchObject({ colour: 'yellow', weightText: '80' });
    }
    expect(run(atReps(8), { type: 'reps', text: '' }, { type: 'reps', text: '1' }, { type: 'reps', text: '12' }))
      .toMatchObject({ colour: 'green', weightText: '70', repsText: '12' });
  });
});

describe('reps', () => {
  it('parses whole reps from 1', () => {
    expect(parseReps('1')).toBe(1);
    expect(parseReps(' 12 ')).toBe(12);
    expect(parseReps('08')).toBe(8);
    for (const text of ['', '0', '-1', '8.5', '8,5', 'eight']) expect(parseReps(text)).toBeNull();
  });

  it('never steps below 1, and starts at 1 from blank', () => {
    expect(run(atReps(5), { type: 'reps', text: '1' }, { type: 'stepReps', delta: -1 }).repsText).toBe('1');
    expect(run(atReps(5), { type: 'reps', text: '' }, { type: 'stepReps', delta: 1 }).repsText).toBe('1');
    expect(run(atReps(5), { type: 'reps', text: '' }, { type: 'stepReps', delta: -1 }).repsText).toBe('1');
  });
});

describe('date', () => {
  it('takes the prediction for the new date while the weight is untouched', () => {
    const state = run(opened('yellow'), { type: 'date', date: '2026-02-01', prediction: LATER });
    expect(state).toMatchObject({ date: '2026-02-01', weightText: '75' });
    expect(state.weightEdited).toBe(false);
  });

  it('uses the new prediction on the next crossing', () => {
    const state = run(
      opened('yellow'),
      { type: 'date', date: '2026-02-01', prediction: LATER },
      { type: 'reps', text: '4' },
    );
    expect(state.weightText).toBe('85');
  });

  it('keeps an edited weight', () => {
    const state = run(
      opened('yellow'),
      { type: 'weight', text: '77' },
      { type: 'date', date: '2026-02-01', prediction: LATER },
    );
    expect(state).toMatchObject({ date: '2026-02-01', weightText: '77' });
  });

  it('goes blank for a date before any entry, and returns with the prediction', () => {
    const before = run(opened('yellow'), { type: 'date', date: '2020-01-01', prediction: null });
    expect(before.weightText).toBe('');
    expect(run(before, { type: 'date', date: TODAY, prediction: PREDICTION }).weightText).toBe('80');
  });

  it('ignores a cleared date', () => {
    expect(run(opened('yellow'), { type: 'date', date: '', prediction: null })).toEqual(opened('yellow'));
  });
});

describe('weight', () => {
  it('marks a typed weight as edited, even when cleared', () => {
    const cleared = run(opened('yellow'), { type: 'weight', text: '' });
    expect(cleared).toMatchObject({ weightText: '', weightEdited: true });
    expect(run(cleared, { type: 'reps', text: '4' }).weightText).toBe('');
  });

  it('steps from the current weight, and from zero when blank', () => {
    expect(run(opened('yellow'), { type: 'stepWeight', delta: 2.5, floor: 0 }).weightText).toBe('82.5');
    expect(run(opened('yellow'), { type: 'stepWeight', delta: -2.5, floor: 0 }).weightText).toBe('77.5');
    expect(run(opened('yellow', null), { type: 'stepWeight', delta: 2.5, floor: 0 }).weightText).toBe('2.5');
  });

  it('steps from a decimal comma', () => {
    const state = run(
      opened('yellow'),
      { type: 'weight', text: '22,5' },
      { type: 'stepWeight', delta: 2.5, floor: 0 },
    );
    expect(state.weightText).toBe('25');
  });

  it('does not step to or below the floor', () => {
    const low = run(opened('yellow'), { type: 'weight', text: '2.5' });
    expect(run(low, { type: 'stepWeight', delta: -2.5, floor: 0 })).toBe(low);
    const blank = opened('yellow', null);
    expect(run(blank, { type: 'stepWeight', delta: -2.5, floor: 0 })).toBe(blank);
  });

  it('knows the floor per equipment and share of bodyweight', () => {
    expect(weightFloor(BARBELL, 80)).toBe(0);
    expect(weightFloor({ equipment: 'dumbbell', bodyweightShare: 1 }, null)).toBe(0);
    expect(weightFloor(BODYWEIGHT, 80)).toBe(-80);
    expect(weightFloor({ equipment: 'bodyweight', bodyweightShare: 0.65 }, 80)).toBeCloseTo(-52, 10);
    expect(weightFloor(BODYWEIGHT, null)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('AC12, AC31: one signed input', () => {
  it.each([
    ['−12,5', -12.5],
    ['-12.5', -12.5],
    ['12,5', 12.5],
    ['+5', 5],
  ])('takes %s as %f kg', (text, kg) => {
    const state = run(opened('yellow', null), { type: 'weight', text });
    expect(submission(state, BODYWEIGHT)?.weightKg).toBe(kg);
    expect(isAssistance(state)).toBe(kg < 0);
  });

  it('holds a lone minus until digits are typed', () => {
    const state = run(opened('yellow', null), { type: 'weight', text: '-' });
    expect(isAssistance(state)).toBe(true);
    expect(submission(state, BODYWEIGHT)).toBeNull();
    expect(submission(run(state, { type: 'weight', text: '-20' }), BODYWEIGHT)?.weightKg).toBe(-20);
  });

  it('steps down through zero into assistance', () => {
    const state = run(
      opened('yellow', null),
      { type: 'weight', text: '0' },
      { type: 'stepWeight', delta: -2.5, floor: -80 },
    );
    expect(state.weightText).toBe('−2.5');
    expect(isAssistance(state)).toBe(true);
  });

  it('steps assistance up towards zero', () => {
    const state = run(opened('red', { red: -2.5, yellow: -10, green: -15 }), {
      type: 'stepWeight',
      delta: 2.5,
      floor: -80,
    });
    expect(state.weightText).toBe('0');
    expect(isAssistance(state)).toBe(false);
  });

});

describe('editing an entry', () => {
  const state = editLogForm(entry);

  it('starts from the entry, on its colour, as edited', () => {
    expect(state).toMatchObject({
      date: '2026-03-01',
      repsText: '4',
      weightText: '82.5',
      colour: 'red',
      weightEdited: true,
    });
  });

  it('keeps the weight across a crossing and a date change', () => {
    const next = run(
      state,
      { type: 'reps', text: '10' },
      { type: 'date', date: '2026-03-02', prediction: PREDICTION },
    );
    expect(next).toMatchObject({ colour: 'green', weightText: '82.5' });
  });

  it('shows an assisted entry as assistance', () => {
    const assisted = editLogForm({ ...entry, weightKg: -15 });
    expect(assisted.weightText).toBe('−15');
    expect(isAssistance(assisted)).toBe(true);
  });
});

describe('submission', () => {
  it('returns the parsed entry', () => {
    expect(submission(opened('yellow'), BARBELL)).toEqual({
      date: TODAY,
      weightKg: 80,
      reps: 8,
      bodyweightKg: null,
    });
  });

  it('parses a decimal comma', () => {
    const state = run(opened('yellow'), { type: 'weight', text: '62,5' });
    expect(submission(state, BARBELL)?.weightKg).toBe(62.5);
  });

  it.each([
    ['blank weight', { type: 'weight', text: '' }],
    ['unreadable weight', { type: 'weight', text: '6x' }],
    ['zero weight', { type: 'weight', text: '0' }],
    ['negative weight', { type: 'weight', text: '-5' }],
    ['blank reps', { type: 'reps', text: '' }],
    ['zero reps', { type: 'reps', text: '0' }],
    ['fractional reps', { type: 'reps', text: '8.5' }],
    ['a future date', { type: 'date', date: '2026-03-11', prediction: PREDICTION }],
  ] as [string, LogFormAction][])('refuses %s', (_name, action) => {
    expect(submission(run(opened('yellow'), action), BARBELL)).toBeNull();
  });

  it('allows today and past dates', () => {
    const past = run(opened('yellow'), { type: 'date', date: '2025-01-01', prediction: PREDICTION });
    expect(submission(past, BARBELL)?.date).toBe('2025-01-01');
  });

  describe('bodyweight exercises', () => {
    it('accepts zero as a weight', () => {
      expect(submission(run(opened('yellow', null), { type: 'weight', text: '0' }), BODYWEIGHT)?.weightKg).toBe(0);
    });

    it('turns a typed minus zero into plain zero', () => {
      const state = run(opened('yellow', null), { type: 'weight', text: '−0' });
      expect(Object.is(submission(state, BODYWEIGHT)?.weightKg, 0)).toBe(true);
    });

    it('refuses assistance that reaches the share of bodyweight moved', () => {
      expect(submission(run(opened('yellow', null), { type: 'weight', text: '−80' }), BODYWEIGHT)).toBeNull();
      expect(submission(run(opened('yellow', null), { type: 'weight', text: '−79' }), BODYWEIGHT)?.weightKg).toBe(-79);
      const pushUps = { ...BODYWEIGHT, bodyweightShare: 0.65 };
      expect(submission(run(opened('yellow', null), { type: 'weight', text: '−52' }), pushUps)).toBeNull();
      expect(submission(run(opened('yellow', null), { type: 'weight', text: '−51' }), pushUps)?.weightKg).toBe(-51);
    });

    describe('with no bodyweight recorded', () => {
      const context: LogFormContext = { ...BODYWEIGHT, bodyweightKg: null };
      const typed = run(opened('yellow', null), { type: 'weight', text: '10' });

      it('asks for bodyweight only then', () => {
        expect(needsBodyweight(context)).toBe(true);
        expect(needsBodyweight(BODYWEIGHT)).toBe(false);
        expect(needsBodyweight(BARBELL)).toBe(false);
      });

      it('refuses to save until it has one, so the model never assumes 80 kg', () => {
        expect(submission(typed, context)).toBeNull();
        expect(submission(run(typed, { type: 'bodyweight', text: '0' }), context)).toBeNull();
        expect(submission(run(typed, { type: 'bodyweight', text: 'x' }), context)).toBeNull();
      });

      it('returns the typed bodyweight, decimal comma included', () => {
        const state = run(typed, { type: 'bodyweight', text: '74,5' });
        expect(submission(state, context)).toMatchObject({ weightKg: 10, bodyweightKg: 74.5 });
      });

      it('checks assistance against the typed bodyweight', () => {
        const state = run(typed, { type: 'bodyweight', text: '60' }, { type: 'weight', text: '−60' });
        expect(submission(state, context)).toBeNull();
      });
    });
  });
});
