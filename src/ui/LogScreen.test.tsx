import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, today } from '../domain/date';
import { addEntry, deleteEntry, setBodyweight, updateEntry } from '../store';
import { LogScreen } from './LogScreen';
import { BENCH, CURL, PULLUP, SQUAT, entry, queriesFor } from './testing';

vi.mock('../store', () => ({
  addEntry: vi.fn(async () => ({})),
  updateEntry: vi.fn(async () => {}),
  deleteEntry: vi.fn(async () => {}),
  setBodyweight: vi.fn(async () => {}),
}));

const TODAY = today();

function form(): HTMLElement {
  return document.querySelector('form') as HTMLElement;
}
const weight = () => screen.getByLabelText(/^(Weight|Added weight|Per hand)$/) as HTMLInputElement;
const reps = () => screen.getByLabelText('Reps') as HTMLInputElement;
const date = () => screen.getByLabelText('Date') as HTMLInputElement;
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const colour = () => form().getAttribute('data-colour');

function exerciseRoute(exerciseId: string): string {
  return `#/exercise/${encodeURIComponent(exerciseId)}`;
}

beforeEach(() => {
  window.location.hash = '';
  vi.mocked(addEntry).mockClear();
  vi.mocked(updateEntry).mockClear();
  vi.mocked(deleteEntry).mockClear();
  vi.mocked(setBodyweight).mockClear();
});

afterEach(cleanup);

describe('AC5: opening the form', () => {
  it('starts on the predicted weight, target reps and today, with no sets field', () => {
    const queries = queriesFor([entry(BENCH, 7, 80, 8)]);
    render(<LogScreen queries={queries} exerciseId={BENCH} />);
    expect(weight().value).toBe(String(queries.predict(BENCH, TODAY)?.yellow));
    expect(reps().value).toBe('8');
    expect(date().value).toBe(TODAY);
    expect(colour()).toBe('yellow');
    expect(screen.queryByLabelText(/sets/i)).toBeNull();
  });

  it('starts a new exercise yellow, 8 reps, blank weight, with Save disabled', () => {
    render(<LogScreen queries={queriesFor([])} exerciseId={BENCH} />);
    expect(colour()).toBe('yellow');
    expect(reps().value).toBe('8');
    expect(weight().value).toBe('');
    expect(save().disabled).toBe(true);
  });

  it('limits the date to today', () => {
    render(<LogScreen queries={queriesFor([])} exerciseId={BENCH} />);
    expect(date().max).toBe(TODAY);
  });

  it('links the exercise name in the header to the exercise screen', () => {
    const queries = queriesFor([]);
    render(<LogScreen queries={queries} exerciseId={BENCH} />);
    const title = screen.getByRole('link', { name: queries.exercise(BENCH)!.name });
    expect(title.getAttribute('href')).toBe(exerciseRoute(BENCH));
  });

  it('AC9: a latest entry of 4 reps still opens on red, at 5 reps and the red prediction', () => {
    const queries = queriesFor([entry(BENCH, 7, 90, 4)]);
    render(<LogScreen queries={queries} exerciseId={BENCH} />);
    expect(colour()).toBe('red');
    expect(reps().value).toBe('5');
    expect(weight().value).toBe(String(queries.predict(BENCH, TODAY)?.red));
  });
});

describe('AC6: reps crossing a boundary', () => {
  it.each([
    ['down across 6/7', 2, 'Less reps', 'red'],
    ['up across 9/10', 2, 'More reps', 'green'],
  ] as const)('switches colour and weight stepping %s', async (_name, taps, button, expected) => {
    const user = userEvent.setup();
    const queries = queriesFor([entry(BENCH, 7, 80, 8)]);
    render(<LogScreen queries={queries} exerciseId={BENCH} />);
    for (let tap = 0; tap < taps; tap++) await user.click(screen.getByRole('button', { name: button }));
    expect(colour()).toBe(expected);
    expect(weight().value).toBe(String(queries.predict(BENCH, TODAY)?.[expected]));
  });

  it('jumps across two boundaries when reps are typed', async () => {
    const user = userEvent.setup();
    const queries = queriesFor([entry(BENCH, 7, 90, 4)]);
    render(<LogScreen queries={queries} exerciseId={BENCH} />);
    await user.clear(reps());
    await user.type(reps(), '12');
    expect(colour()).toBe('green');
    expect(weight().value).toBe(String(queries.predict(BENCH, TODAY)?.green));
  });

  it('keeps a typed weight', async () => {
    const user = userEvent.setup();
    render(<LogScreen queries={queriesFor([entry(BENCH, 7, 80, 8)])} exerciseId={BENCH} />);
    await user.clear(weight());
    await user.type(weight(), '77,5');
    await user.clear(reps());
    await user.type(reps(), '4');
    expect(colour()).toBe('red');
    expect(weight().value).toBe('77,5');
  });

  it('stays blank without a prediction', async () => {
    const user = userEvent.setup();
    render(<LogScreen queries={queriesFor([])} exerciseId={BENCH} />);
    await user.click(screen.getByRole('button', { name: 'More reps' }));
    await user.click(screen.getByRole('button', { name: 'More reps' }));
    expect(colour()).toBe('green');
    expect(weight().value).toBe('');
  });
});

describe('date', () => {
  it('takes the prediction for a new date while the weight is unedited', () => {
    const queries = queriesFor([entry(BENCH, 60, 60, 8), entry(BENCH, 1, 100, 8)]);
    render(<LogScreen queries={queries} exerciseId={BENCH} />);
    const earlier = addDays(TODAY, -30);
    fireEvent.change(date(), { target: { value: earlier } });
    expect(weight().value).toBe(String(queries.predict(BENCH, earlier)?.yellow));
    expect(weight().value).not.toBe(String(queries.predict(BENCH, TODAY)?.yellow));
  });

  it('refuses a future date, which iOS pickers may let through', () => {
    render(<LogScreen queries={queriesFor([entry(BENCH, 7, 80, 8)])} exerciseId={BENCH} />);
    fireEvent.change(date(), { target: { value: addDays(TODAY, 1) } });
    expect(save().disabled).toBe(true);
  });
});

describe('saving', () => {
  it('saves a new entry and opens the exercise', async () => {
    const user = userEvent.setup();
    render(<LogScreen queries={queriesFor([])} exerciseId={SQUAT} />);
    await user.type(weight(), '100');
    await user.click(save());
    expect(addEntry).toHaveBeenCalledWith({ exerciseId: SQUAT, date: TODAY, weightKg: 100, reps: 8 });
    await waitFor(() => expect(window.location.hash).toBe(exerciseRoute(SQUAT)));
  });

  it('parses a Swedish decimal comma', async () => {
    const user = userEvent.setup();
    render(<LogScreen queries={queriesFor([])} exerciseId={SQUAT} />);
    await user.type(weight(), '62,5');
    await user.click(save());
    expect(vi.mocked(addEntry).mock.calls[0][0].weightKg).toBe(62.5);
  });

  it('saves once however fast Save is tapped', async () => {
    const user = userEvent.setup();
    render(<LogScreen queries={queriesFor([entry(BENCH, 7, 80, 8)])} exerciseId={BENCH} />);
    await user.dblClick(save());
    expect(addEntry).toHaveBeenCalledTimes(1);
  });

  it('says so when a save fails, and stays on the form', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(addEntry).mockRejectedValueOnce(new Error('quota'));
    const user = userEvent.setup();
    render(<LogScreen queries={queriesFor([entry(BENCH, 7, 80, 8)])} exerciseId={BENCH} />);
    await user.click(save());
    expect(await screen.findByText('Could not save. Try again.')).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(save().disabled).toBe(false);
  });
});

describe('weight steps', () => {
  it('steps by the loadable step learned from this exercise', async () => {
    const user = userEvent.setup();
    const queries = queriesFor([entry(CURL, 3, 20, 8), entry(CURL, 2, 21, 8), entry(CURL, 1, 22, 8)]);
    render(<LogScreen queries={queries} exerciseId={CURL} />);
    await user.clear(weight());
    await user.type(weight(), '20');
    await user.click(screen.getByRole('button', { name: 'More weight' }));
    expect(weight().value).toBe('21');
  });

  it('labels dumbbells per hand', () => {
    render(<LogScreen queries={queriesFor([])} exerciseId={CURL} />);
    expect(screen.getByLabelText('Per hand')).toBeTruthy();
  });

  it('uses a decimal keypad', () => {
    render(<LogScreen queries={queriesFor([])} exerciseId={BENCH} />);
    expect(weight().inputMode).toBe('decimal');
  });
});

describe('AC12: bodyweight exercises', () => {
  const toggle = () => screen.getByRole('button', { name: 'Assistance' });

  it('labels the field Added weight and accepts 0', async () => {
    const user = userEvent.setup();
    render(<LogScreen queries={queriesFor([])} exerciseId={PULLUP} />);
    await user.type(screen.getByLabelText('Added weight'), '0');
    await user.click(save());
    expect(vi.mocked(addEntry).mock.calls[0][0].weightKg).toBe(0);
  });

  it('turns typed weight into assistance with the toggle, as the keypad has no minus', async () => {
    const user = userEvent.setup();
    render(<LogScreen queries={queriesFor([])} exerciseId={PULLUP} />);
    await user.type(weight(), '12,5');
    expect(screen.queryByText('Assistance')).toBeNull();
    await user.click(toggle());
    expect(weight().value).toBe('−12,5');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Assistance')).toBeTruthy();
    await user.click(save());
    expect(vi.mocked(addEntry).mock.calls[0][0].weightKg).toBe(-12.5);
  });

  it('shows a negative prediction as assistance', () => {
    const queries = queriesFor([entry(PULLUP, 7, -30, 8)]);
    render(<LogScreen queries={queries} exerciseId={PULLUP} />);
    expect(weight().value).toMatch(/^−\d/);
    expect(screen.getByText('Assistance')).toBeTruthy();
  });

  it('steps below zero into assistance', async () => {
    const user = userEvent.setup();
    render(<LogScreen queries={queriesFor([])} exerciseId={PULLUP} />);
    await user.type(weight(), '0');
    await user.click(screen.getByRole('button', { name: 'Less weight' }));
    expect(weight().value).toBe('−2.5');
  });

  it('has no sign toggle on loaded exercises', () => {
    render(<LogScreen queries={queriesFor([])} exerciseId={BENCH} />);
    expect(screen.queryByRole('button', { name: 'Assistance' })).toBeNull();
  });

  it('asks for bodyweight when none is recorded, and saves it with the entry', async () => {
    const user = userEvent.setup();
    render(<LogScreen queries={queriesFor([], { bodyweights: [] })} exerciseId={PULLUP} />);
    await user.type(weight(), '10');
    expect(save().disabled).toBe(true);
    await user.type(screen.getByLabelText('Bodyweight'), '74,5');
    await user.click(save());
    expect(setBodyweight).toHaveBeenCalledWith(TODAY, 74.5);
    expect(vi.mocked(setBodyweight).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(addEntry).mock.invocationCallOrder[0],
    );
  });

  it('does not ask once a bodyweight is recorded, or on other equipment', () => {
    const { unmount } = render(<LogScreen queries={queriesFor([])} exerciseId={PULLUP} />);
    expect(screen.queryByLabelText('Bodyweight')).toBeNull();
    unmount();
    render(<LogScreen queries={queriesFor([], { bodyweights: [] })} exerciseId={BENCH} />);
    expect(screen.queryByLabelText('Bodyweight')).toBeNull();
  });
});

describe('editing an entry', () => {
  const logged = entry(BENCH, 3, 82.5, 4);
  const queries = queriesFor([entry(BENCH, 7, 80, 8), logged]);
  const edit = () => render(<LogScreen queries={queries} exerciseId={BENCH} entryId={logged.id} />);

  it('starts from the entry', () => {
    edit();
    expect(weight().value).toBe('82.5');
    expect(reps().value).toBe('4');
    expect(date().value).toBe(logged.date);
    expect(colour()).toBe('red');
  });

  it('counts as edited, so a crossing keeps the weight', async () => {
    const user = userEvent.setup();
    edit();
    await user.clear(reps());
    await user.type(reps(), '8');
    expect(colour()).toBe('yellow');
    expect(weight().value).toBe('82.5');
  });

  it('saves with updateEntry and opens the exercise', async () => {
    const user = userEvent.setup();
    edit();
    await user.click(screen.getByRole('button', { name: 'More reps' }));
    await user.click(save());
    expect(updateEntry).toHaveBeenCalledWith(logged.id, { date: logged.date, weightKg: 82.5, reps: 5 });
    expect(addEntry).not.toHaveBeenCalled();
    await waitFor(() => expect(window.location.hash).toBe(exerciseRoute(BENCH)));
  });

  it('deletes after a second tap and opens the exercise', async () => {
    const user = userEvent.setup();
    edit();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteEntry).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Tap again to delete' }));
    expect(deleteEntry).toHaveBeenCalledWith(logged.id);
    await waitFor(() => expect(window.location.hash).toBe(exerciseRoute(BENCH)));
  });

  it('offers no Delete on a new entry', () => {
    render(<LogScreen queries={queries} exerciseId={BENCH} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('renders nothing for an entry that no longer exists', () => {
    const { container } = render(<LogScreen queries={queries} exerciseId={BENCH} entryId="gone" />);
    expect(container.innerHTML).toBe('');
  });
});
