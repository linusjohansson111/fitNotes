import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../domain/date';

const TODAY = '2026-06-15';
const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';
const ASSISTED = 'gap_assisted_pull_up_machine';

type Store = typeof import('../store');
type Screen = typeof import('./ExerciseScreen');

let store: Store;
let ExerciseScreen: Screen['ExerciseScreen'];

/** A fresh store over an empty database, as in a new install. */
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  store = await import('../store');
  ({ ExerciseScreen } = await import('./ExerciseScreen'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function open(exerciseId = BENCH) {
  const view = render(<ExerciseScreen exerciseId={exerciseId} />);
  await waitFor(() => expect(view.container.firstChild).not.toBeNull());
  return view;
}

function log(date: string, weightKg: number, reps: number, exerciseId = BENCH) {
  return store.addEntry({ exerciseId, date, weightKg, reps });
}

const weight = (container: HTMLElement, colour: string) => {
  const cell = container.querySelector(`.ins-weight[data-colour="${colour}"]`) as HTMLElement;
  return Number(cell.querySelector('.ins-weight-kg')?.textContent?.replace('−', '-'));
};

const historyRows = () => within(screen.getByRole('list', { name: 'History' })).getAllByRole('link');
const circles = (container: HTMLElement) => container.querySelectorAll('circle').length;

describe('ExerciseScreen', () => {
  it('AC7: after a first entry of 80 kg x 8, shows all three colours and no uncertainty', async () => {
    await log(TODAY, 80, 8);
    const { container } = await open();

    expect(weight(container, 'yellow')).toBe(80);
    expect(weight(container, 'red')).toBeGreaterThanOrEqual(87);
    expect(weight(container, 'red')).toBeLessThanOrEqual(89);
    expect(weight(container, 'green')).toBeGreaterThanOrEqual(72.5);
    expect(weight(container, 'green')).toBeLessThanOrEqual(74.5);
    expect(weight(container, 'red')).toBeGreaterThan(weight(container, 'yellow'));
    expect(weight(container, 'yellow')).toBeGreaterThan(weight(container, 'green'));

    expect(screen.getByText('kg × 5')).toBeTruthy();
    expect(screen.getByText('kg × 8')).toBeTruthy();
    expect(screen.getByText('kg × 11')).toBeTruthy();
    expect(container.textContent).not.toMatch(/±|≈|~|%|accura|estimat|uncertain|confidence|range/i);
  });

  it('AC13: brightens only the current colour', async () => {
    await log(TODAY, 80, 8);
    const { container } = await open();
    const bright = [...container.querySelectorAll('.ins-weight--now')];
    expect(bright.map((cell) => cell.getAttribute('data-colour'))).toEqual(['yellow']);
  });

  it('links a large Log button in the current colour to the log form', async () => {
    await log(TODAY, 100, 4);
    await open();
    const button = screen.getByRole('link', { name: 'Log' });
    expect(button.getAttribute('href')).toBe(`#/log/${encodeURIComponent(BENCH)}`);
    expect(button.className).toContain('ins-red');
  });

  it('has a back link home and the name in the header', async () => {
    await log(TODAY, 80, 8);
    await open();
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('#/');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Bench Press');
  });

  it('AC12: shows assistance as a negative weight', async () => {
    await log(TODAY, -30, 8, ASSISTED);
    const { container } = await open(ASSISTED);
    expect(container.querySelector('.ins-weight[data-colour="yellow"] .ins-weight-kg')?.textContent).toBe('−30');
    expect(screen.getByText(/^Last −30 kg × 8/)).toBeTruthy();
  });

  it('AC13: shows three lines, entry dots and ranges, defaulting to 3M', async () => {
    await log(addDays(TODAY, -300), 70, 8);
    await log(addDays(TODAY, -30), 80, 8);
    await log(addDays(TODAY, -10), 82.5, 8);
    const { container } = await open();

    expect(container.querySelectorAll('path.ins-line')).toHaveLength(3);
    expect(circles(container)).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: '1Y' }));
    expect(circles(container)).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(circles(container)).toBe(3);
  });

  it('AC13: shows when and what the last session was', async () => {
    await log(addDays(TODAY, -3), 80, 8);
    await open();
    expect(screen.getByText('Last 80 kg × 8 · 3 days ago')).toBeTruthy();
  });

  it('AC13: lists an editable history, newest first, with date, set and colour', async () => {
    const older = await log(addDays(TODAY, -40), 70, 11);
    const newer = await log(addDays(TODAY, -2), 90, 4);
    await open();

    const rows = historyRows();
    expect(rows.map((row) => row.textContent)).toEqual(['13 Jun90 kg × 4', '6 May70 kg × 11']);
    expect(rows[0].getAttribute('href')).toBe(`#/log/${encodeURIComponent(BENCH)}/${newer.id}`);
    expect(rows[1].getAttribute('href')).toBe(`#/log/${encodeURIComponent(BENCH)}/${older.id}`);
    expect(rows[0].querySelector('[data-colour]')?.getAttribute('data-colour')).toBe('red');
    expect(rows[1].querySelector('[data-colour]')?.getAttribute('data-colour')).toBe('green');
  });

  it('names the year in the history when it is not this year', async () => {
    await log('2025-12-30', 70, 8);
    await open();
    expect(historyRows()[0].textContent).toContain('30 Dec 2025');
  });

  it('AC14: recalculates predictions, graph, last session and history after an edit', async () => {
    const entry = await log(TODAY, 80, 8);
    const { container } = await open();
    const before = container.querySelector('path.ins-lead')?.getAttribute('d');

    await act(() => store.addEntry({ exerciseId: BENCH, date: addDays(TODAY, -7), weightKg: 60, reps: 8 }));
    expect(container.querySelector('path.ins-lead')?.getAttribute('d')).not.toBe(before);
    const redBefore = weight(container, 'red');

    await act(() => store.updateEntry(entry.id, { weightKg: 120, reps: 4 }));

    expect(weight(container, 'red')).toBeGreaterThan(redBefore);
    expect(container.querySelector('.ins-weight--now')?.getAttribute('data-colour')).toBe('red');
    expect(screen.getByText('Last 120 kg × 4 · today')).toBeTruthy();
    expect(historyRows()[0].textContent).toContain('120 kg × 4');
    expect(screen.getByRole('link', { name: 'Log' }).className).toContain('ins-red');
  });

  it('AC14: recalculates after a delete, back to the state with no entries', async () => {
    const first = await log(addDays(TODAY, -7), 60, 8);
    const second = await log(TODAY, 100, 8);
    const { container } = await open();
    expect(weight(container, 'yellow')).toBeGreaterThan(90);

    await act(() => store.deleteEntry(second.id));
    expect(weight(container, 'yellow')).toBeLessThan(70);
    expect(historyRows()).toHaveLength(1);

    await act(() => store.deleteEntry(first.id));
    expect(container.querySelector('svg[role="img"]')).toBeNull();
    expect(screen.queryByRole('list', { name: 'History' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Log' })).toBeTruthy();
  });

  it('with no entries, shows the Log button and no graph', async () => {
    await open();
    expect(screen.getByRole('link', { name: 'Log' }).className).toContain('ins-yellow');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: '3M' })).toBeNull();
    expect(screen.queryByText(/^Last/)).toBeNull();
  });

  it('with an unknown id, shows one line and a link home', async () => {
    const { container } = await open('no-such-exercise');
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('#/');
    expect(screen.queryByRole('link', { name: 'Log' })).toBeNull();
  });

  describe('note', () => {
    const savedNote = async () => {
      await store.readAll();
      await waitFor(() => expect(store.getAppData()?.notes.length).toBeGreaterThan(0));
      return store.getAppData()?.notes[0].note;
    };
    const note = () => screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement;

    it('AC13: shows the stored note', async () => {
      await store.setNote(BENCH, 'Pause on the chest');
      await open();
      expect(note().value).toBe('Pause on the chest');
    });

    it('saves on blur', async () => {
      await open();
      fireEvent.change(note(), { target: { value: 'Grip wider' } });
      fireEvent.blur(note());
      expect(await savedNote()).toBe('Grip wider');
    });

    it('saves on unmount, so leaving the screen cannot lose it', async () => {
      const { unmount } = await open();
      fireEvent.change(note(), { target: { value: 'Left mid-sentence' } });
      unmount();
      expect(await savedNote()).toBe('Left mid-sentence');
    });

    it('saves when the app goes to the background', async () => {
      await open();
      fireEvent.change(note(), { target: { value: 'Switched app' } });
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      fireEvent(document, new Event('visibilitychange'));
      expect(await savedNote()).toBe('Switched app');
    });

    it('writes nothing when the note did not change', async () => {
      await store.setNote(BENCH, 'Same');
      const stamp = store.getAppData()?.notes[0].updatedAt;
      const { unmount } = await open();
      fireEvent.blur(note());
      unmount();
      await act(() => store.addEntry({ exerciseId: BENCH, date: TODAY, weightKg: 80, reps: 8 }));
      expect(store.getAppData()?.notes[0].updatedAt).toBe(stamp);
    });

    it('saves each exercise under its own id when the screen switches exercise', async () => {
      const view = await open();
      fireEvent.change(note(), { target: { value: 'Bench note' } });
      view.rerender(<ExerciseScreen exerciseId={ASSISTED} />);
      expect(note().value).toBe('');
      await waitFor(() => expect(store.getAppData()?.notes.length).toBe(1));
      expect(store.getAppData()?.notes[0]).toMatchObject({ exerciseId: BENCH, note: 'Bench note' });
    });
  });
});
