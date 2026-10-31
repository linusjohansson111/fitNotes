import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BENCH } from './ui/testing';

vi.mock('./ui/ExerciseScreen', () => ({
  ExerciseScreen: ({ exerciseId }: { exerciseId: string }) => <p>exercise {exerciseId}</p>,
}));
vi.mock('./ui/MapScreen', () => ({ MapScreen: () => <p>muscle map</p> }));
vi.mock('./ui/BodyMap', () => ({ BodyMap: () => null }));
vi.mock('./backup', () => ({
  connectBackup: vi.fn(),
  startBackup: vi.fn(),
  useBackupStatus: () => ({ connected: false, state: 'idle', lastBackupAt: null, error: null }),
}));

type Store = typeof import('./store');

let store: Store;
let App: (typeof import('./App'))['App'];

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  window.location.hash = '';
  store = await import('./store');
  ({ App } = await import('./App'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AC1: the shell', () => {
  it('renders a blank page until the store has loaded, then home with the bar', async () => {
    const { container } = render(<App />);
    expect(container.innerHTML).toBe('');
    expect(await screen.findByText('Nothing logged yet.')).toBeTruthy();
    for (const name of ['Home', 'Add exercise', 'Map']) expect(screen.getByRole('link', { name })).toBeTruthy();
  });

  it('never touches the network to show home and save an entry', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    window.location.hash = `#/log/${BENCH}`;
    render(<App />);
    await user.type(await screen.findByLabelText('Weight'), '80');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(`exercise ${BENCH}`)).toBeTruthy();
    expect((await store.readAll()).entries).toMatchObject([{ exerciseId: BENCH, weightKg: 80, reps: 8 }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the screen for each route, following the hash', async () => {
    render(<App />);
    await screen.findByText('Nothing logged yet.');
    window.location.hash = '#/map';
    expect(await screen.findByText('muscle map')).toBeTruthy();
    window.location.hash = '#/settings';
    expect(await screen.findByLabelText('Bodyweight')).toBeTruthy();
    window.location.hash = '#/search';
    expect(await screen.findByRole('searchbox')).toBeTruthy();
    window.location.hash = '#/custom/Odd%20Lift';
    expect(((await screen.findByLabelText('Exercise name')) as HTMLInputElement).value).toBe('Odd Lift');
    window.location.hash = '#/';
    expect(await screen.findByText('Nothing logged yet.')).toBeTruthy();
  });

  it('starts a fresh form when the route moves to another exercise', async () => {
    const user = userEvent.setup();
    window.location.hash = `#/log/${BENCH}`;
    render(<App />);
    await user.type(await screen.findByLabelText('Weight'), '80');
    window.location.hash = '#/log/Barbell_Squat';
    await screen.findByRole('link', { name: 'Barbell Squat' });
    expect((screen.getByLabelText('Weight') as HTMLInputElement).value).toBe('');
  });
});

describe('AC3: opening search', () => {
  it.each(['Add exercise', 'Add an exercise'])('focuses the input within a tap on %s', async (name) => {
    render(<App />);
    const link = await screen.findByRole('link', { name });
    // No awaiting after the tap: iOS raises the keyboard only for a focus inside it.
    fireEvent.click(link);
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    expect(window.location.hash).toBe('#/search');
  });
});

describe('AC5: a form left open overnight', () => {
  it("restarts on today's date when the app comes back on a new day", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 2, 1, 23, 50));
    window.location.hash = `#/log/${BENCH}`;
    render(<App />);
    const date = () => screen.getByLabelText('Date') as HTMLInputElement;
    await screen.findByLabelText('Date');
    expect(date().value).toBe('2026-03-01');

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(date().value).toBe('2026-03-01');

    vi.setSystemTime(new Date(2026, 2, 2, 7, 0));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(date().value).toBe('2026-03-02');
  });
});

describe('AC4: repeating a lift', () => {
  it('takes two taps from home and shows the new next weight', async () => {
    const user = userEvent.setup();
    await store.addEntry({ exerciseId: BENCH, date: '2026-01-01', weightKg: 80, reps: 8 });
    render(<App />);
    const name = 'Barbell Bench Press - Medium Grip';

    await user.click(await screen.findByText(name));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await screen.findByText(`exercise ${BENCH}`);

    await waitFor(async () => expect((await store.readAll()).entries).toHaveLength(2));
    await user.click(screen.getByRole('link', { name: 'Home' }));
    expect(await screen.findByText(name)).toBeTruthy();
  });
});

describe('boot', () => {
  it('starts backup', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    const { startBackup } = await import('./backup');
    await import('./main');
    expect(startBackup).toHaveBeenCalled();
    root.remove();
  });
});
