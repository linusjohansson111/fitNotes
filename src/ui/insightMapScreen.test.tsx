import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STANDARDS } from '../balance/standards';
import { EXERCISES } from '../data';
import type { Equipment, Muscle } from '../domain/types';
import { e1rm } from '../model';

const TODAY = '2026-06-15';
const BODYWEIGHT = 80;
const YELLOW = 'rgb(255, 214, 10)';
const GREY = 'rgb(58, 58, 60)';
const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';

type Store = typeof import('../store');

let store: Store;
let MapScreen: typeof import('./MapScreen').MapScreen;
let BodyMap: typeof import('./BodyMap').BodyMap;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  store = await import('../store');
  ({ MapScreen } = await import('./MapScreen'));
  ({ BodyMap } = await import('./BodyMap'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function open() {
  const view = render(<MapScreen />);
  await waitFor(() => expect(view.container.querySelector('polygon')).not.toBeNull());
  return view;
}

/** A polygon's `points` for each muscle, read from the library's own click. */
function polygonsByMuscle(): Map<Muscle, string[]> {
  const found = new Map<Muscle, string[]>();
  const onMuscle = vi.fn<(muscle: Muscle) => void>();
  const { container, unmount } = render(<BodyMap fills={{}} onMuscle={onMuscle} />);
  for (const polygon of container.querySelectorAll('polygon')) {
    onMuscle.mockClear();
    fireEvent.click(polygon);
    const muscle = onMuscle.mock.calls[0]?.[0];
    if (muscle) found.set(muscle, [...(found.get(muscle) ?? []), polygon.getAttribute('points') ?? '']);
  }
  unmount();
  return found;
}

/** The colour each muscle has on the rendered map; every polygon of it must agree. */
function fillsOnScreen(container: HTMLElement): Map<Muscle, string> {
  const fills = new Map<Muscle, string>();
  const onScreen = [...container.querySelectorAll('polygon')];
  for (const [muscle, points] of polygonsByMuscle()) {
    const colours = onScreen
      .filter((polygon) => points.includes(polygon.getAttribute('points') ?? ''))
      .map((polygon) => polygon.style.fill);
    expect(new Set(colours).size, muscle).toBe(1);
    fills.set(muscle, colours[0]);
  }
  return fills;
}

function channels(colour: string): number[] {
  return (colour.match(/\d+/g) ?? []).map(Number);
}

/** The logged weight whose first-entry 1RM is `target`, in the model's logged terms. */
function weightForOneRepMax(target: number, equipment: Equipment): number {
  const loadOf = (logged: number) =>
    equipment === 'dumbbell' ? 2 * logged : equipment === 'bodyweight' ? BODYWEIGHT + logged : logged;
  const oneRepMax = (logged: number) => e1rm(loadOf(logged), 8) / (equipment === 'dumbbell' ? 2 : 1);
  // The curve only holds for a real load, so the search must not leave that.
  let [low, high] = [equipment === 'bodyweight' ? 1 - BODYWEIGHT : 1, 1000];
  for (let step = 0; step < 80; step += 1) {
    const middle = (low + high) / 2;
    if (oneRepMax(middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** Logs the first exercise of every counted lift so that its 1RM sits at `level`. */
async function logAllAtLevel(level: number) {
  await store.setBodyweight('2026-01-01', BODYWEIGHT);
  for (const { exerciseIds, raise, standards } of STANDARDS) {
    const [exerciseId] = exerciseIds;
    const equipment = EXERCISES.find(({ id }) => id === exerciseId)?.equipment ?? 'other';
    const weightKg = weightForOneRepMax(raise * standards[BODYWEIGHT][level], equipment);
    await store.addEntry({ exerciseId, date: TODAY, weightKg, reps: 8 });
  }
}

describe('MapScreen', () => {
  it('AC15: with nothing logged, shows the grey figure and one line', async () => {
    const { container } = await open();
    const colours = new Set([...container.querySelectorAll('polygon')].map((polygon) => polygon.style.fill));
    expect(colours).toEqual(new Set([GREY]));
    expect(screen.getByText(/to fill the map/)).toBeTruthy();
    expect(screen.queryByText('Lagging')).toBeNull();
  });

  it.each([1, 2, 3])('AC15: with all counted lifts at level %i, every muscle with data is exactly yellow', async (level) => {
    await logAllAtLevel(level);
    const { container } = await open();
    const fills = fillsOnScreen(container);
    const withData = [...fills].filter(([, colour]) => colour !== GREY);
    expect(withData.length).toBeGreaterThan(10);
    for (const [muscle, colour] of withData) expect(colour, muscle).toBe(YELLOW);
    expect(fills.get('obliques')).toBe(GREY);
    expect(fills.get('neck')).toBe(GREY);
  });

  it('AC15: a lagging muscle goes towards red and a stronger one towards green, smoothly', async () => {
    await store.setBodyweight('2026-01-01', BODYWEIGHT);
    // Curl far below squat and deadlift: arms lag behind legs and back.
    await store.addEntry({ exerciseId: 'Barbell_Squat', date: TODAY, weightKg: 160, reps: 8 });
    await store.addEntry({ exerciseId: 'Barbell_Deadlift', date: TODAY, weightKg: 180, reps: 8 });
    await store.addEntry({ exerciseId: 'Barbell_Curl', date: TODAY, weightKg: 30, reps: 8 });
    await store.addEntry({ exerciseId: BENCH, date: TODAY, weightKg: 80, reps: 8 });
    const { container } = await open();
    const fills = fillsOnScreen(container);

    const biceps = channels(fills.get('biceps') ?? '');
    const quads = channels(fills.get('quadriceps') ?? '');
    expect(biceps[1]).toBeLessThan(214); // Less green than yellow: towards red.
    expect(biceps[0]).toBe(255);
    expect(quads[0]).toBeLessThan(255); // Less red than yellow: towards green.
    expect(quads[1]).toBeGreaterThan(200);

    const known = [...fills.values()].filter((colour) => colour !== GREY);
    expect(new Set(known).size).toBeGreaterThan(3);
  });

  it('AC15: tapping a muscle shows its level, the average and its lifts with 1RM', async () => {
    await store.setBodyweight('2026-01-01', BODYWEIGHT);
    await store.addEntry({ exerciseId: BENCH, date: TODAY, weightKg: 100, reps: 8 });
    await store.addEntry({ exerciseId: 'Barbell_Squat', date: TODAY, weightKg: 120, reps: 8 });
    const { container } = await open();
    const chest = polygonsByMuscle().get('chest')?.[0];

    fireEvent.click(container.querySelector(`polygon[points="${chest}"]`) as Element);

    const detail = screen.getByRole('region', { name: 'Chest' });
    expect(detail.textContent).toMatch(/(Beginner|Novice|Intermediate|Advanced|Elite) \d\.\d/);
    expect(detail.textContent).toMatch(/Your average \d\.\d/);
    expect(detail.textContent).toMatch(/Bench Press\d+ kg/);
  });

  it('AC15: tapping a muscle with no data says so in a line', async () => {
    await store.setBodyweight('2026-01-01', BODYWEIGHT);
    await store.addEntry({ exerciseId: BENCH, date: TODAY, weightKg: 100, reps: 8 });
    const { container } = await open();
    const calves = polygonsByMuscle().get('calves')?.[0];

    fireEvent.click(container.querySelector(`polygon[points="${calves}"]`) as Element);

    expect(screen.getByRole('region', { name: 'Calves' }).textContent).toContain('No data');
  });

  it('shows the legend once there is data', async () => {
    await store.setBodyweight('2026-01-01', BODYWEIGHT);
    await store.addEntry({ exerciseId: BENCH, date: TODAY, weightKg: 100, reps: 8 });
    await open();
    for (const label of ['Lagging', 'In proportion', 'Ahead']) expect(screen.getByText(label)).toBeTruthy();
  });

  it('AC14: recalculates after an entry is edited or deleted', async () => {
    await store.setBodyweight('2026-01-01', BODYWEIGHT);
    await store.addEntry({ exerciseId: BENCH, date: TODAY, weightKg: 100, reps: 8 });
    await store.addEntry({ exerciseId: 'Barbell_Squat', date: TODAY, weightKg: 120, reps: 8 });
    const curl = await store.addEntry({ exerciseId: 'Barbell_Curl', date: TODAY, weightKg: 40, reps: 8 });
    const { container } = await open();
    const before = fillsOnScreen(container);

    await act(() => store.updateEntry(curl.id, { weightKg: 70 }));
    const edited = fillsOnScreen(container);
    expect(edited.get('biceps')).not.toBe(before.get('biceps'));

    await act(() => store.deleteEntry(curl.id));
    expect(fillsOnScreen(container).get('biceps')).toBe(GREY);
  });

  it('AC16: a logged custom exercise leaves the map unchanged', async () => {
    await store.setBodyweight('2026-01-01', BODYWEIGHT);
    await store.addEntry({ exerciseId: BENCH, date: TODAY, weightKg: 100, reps: 8 });
    const { container } = await open();
    const before = fillsOnScreen(container);

    await act(async () => {
      const custom = await store.saveCustomExercise({
        id: '',
        name: 'Odd lift',
        group: 'Chest',
        primaryMuscles: ['chest'],
        secondaryMuscles: [],
        equipment: 'machine',
      });
      await store.addEntry({ exerciseId: custom.id, date: TODAY, weightKg: 500, reps: 8 });
    });

    expect(fillsOnScreen(container)).toEqual(before);
  });

  describe('bodyweight', () => {
    const input = () => screen.getByRole('textbox', { name: 'Bodyweight' }) as HTMLInputElement;

    it('asks for it while the map runs on the default, with a decimal keypad', async () => {
      await open();
      expect(input().getAttribute('inputmode')).toBe('decimal');
    });

    it('takes a decimal comma, saves on blur and then goes away', async () => {
      await open();
      fireEvent.change(input(), { target: { value: '82,5' } });
      fireEvent.blur(input());
      await waitFor(() => expect(store.getAppData()?.bodyweights).toHaveLength(1));
      expect(store.getAppData()?.bodyweights[0]).toMatchObject({ date: TODAY, kg: 82.5 });
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Bodyweight' })).toBeNull());
    });

    it('saves from the Save button, once', async () => {
      await open();
      fireEvent.change(input(), { target: { value: '80' } });
      fireEvent.blur(input());
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(store.getAppData()?.bodyweights).toHaveLength(1));
      const stamp = store.getAppData()?.bodyweights[0].updatedAt;
      await act(() => store.addEntry({ exerciseId: BENCH, date: TODAY, weightKg: 80, reps: 8 }));
      expect(store.getAppData()?.bodyweights[0].updatedAt).toBe(stamp);
    });

    it.each(['', 'abc', '0', '-5'])('ignores %j', async (text) => {
      await open();
      fireEvent.change(input(), { target: { value: text } });
      fireEvent.blur(input());
      await act(() => store.addEntry({ exerciseId: BENCH, date: TODAY, weightKg: 80, reps: 8 }));
      expect(store.getAppData()?.bodyweights).toEqual([]);
      expect(input()).toBeTruthy();
    });

    it('is not shown once a bodyweight is recorded', async () => {
      await store.setBodyweight('2026-01-01', BODYWEIGHT);
      await open();
      expect(screen.queryByRole('textbox', { name: 'Bodyweight' })).toBeNull();
    });
  });
});
