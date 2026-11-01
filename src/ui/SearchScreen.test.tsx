import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Muscle } from '../domain/types';
import type { BodyMapProps } from './BodyMap';
import { href } from './nav';
import { SearchScreen } from './SearchScreen';
import { BENCH, queriesFor } from './testing';

vi.mock('./BodyMap', () => ({
  BodyMap: ({ fills, height }: BodyMapProps) => <i data-testid="map" data-fills={JSON.stringify(fills)} data-height={height} />,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const input = () => screen.getByRole('searchbox') as HTMLInputElement;

describe('AC3: search', () => {
  it('focuses the input on open', () => {
    render(<SearchScreen queries={queriesFor([])} />);
    expect(document.activeElement).toBe(input());
  });

  it('lists at most 40 matches from the bank', async () => {
    const user = userEvent.setup();
    render(<SearchScreen queries={queriesFor([])} />);
    await user.type(input(), 'press');
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBe(40));
  });

  it('narrows as the query is typed', async () => {
    const user = userEvent.setup();
    const queries = queriesFor([]);
    render(<SearchScreen queries={queries} />);
    await user.type(input(), 'bench');
    const name = queries.exercise(BENCH)!.name;
    await waitFor(() => expect(screen.getAllByRole('listitem')[0].textContent).toBe(name));
  });

  it('opens the log form from a row', async () => {
    const user = userEvent.setup();
    const queries = queriesFor([]);
    render(<SearchScreen queries={queries} />);
    await user.type(input(), 'bench');
    const row = await screen.findByRole('link', { name: queries.exercise(BENCH)!.name });
    expect(row.getAttribute('href')).toBe(href({ name: 'log', exerciseId: BENCH }));
  });

  it('draws primary muscles brighter than secondary', async () => {
    const user = userEvent.setup();
    const queries = queriesFor([]);
    render(<SearchScreen queries={queries} />);
    await user.type(input(), 'bench');
    const bench = queries.exercise(BENCH)!;
    await waitFor(() => expect(screen.getAllByRole('listitem')[0].textContent).toBe(bench.name));
    const fills = JSON.parse(screen.getAllByTestId('map')[0].dataset.fills!) as Record<Muscle, string>;
    for (const muscle of bench.primaryMuscles) expect(fills[muscle]).toBe('#ffffff');
    for (const muscle of bench.secondaryMuscles) expect(fills[muscle]).toBe('#636366');
  });

  it('ranks the right lift first through a misspelling', async () => {
    const user = userEvent.setup();
    render(<SearchScreen queries={queriesFor([])} />);
    await user.type(input(), 'Incline Dumbell Press');
    await waitFor(() => expect(screen.getAllByRole('listitem')[0].textContent).toBe('Incline Dumbbell Press'));
  });

  it('offers no way to add an exercise, whatever is typed', async () => {
    const user = userEvent.setup();
    render(<SearchScreen queries={queriesFor([])} />);
    await user.type(input(), 'Cable thing / left');
    await waitFor(() => expect(screen.queryAllByRole('listitem')).toEqual([]));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/custom/i)).toBeNull();
  });
});

describe('AC3: mounting maps lazily', () => {
  let observed: Element[];
  let report: IntersectionObserverCallback;

  beforeEach(() => {
    observed = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          report = callback;
        }
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {}
      },
    );
  });

  it('mounts a map only when its row scrolls into view', () => {
    render(<SearchScreen queries={queriesFor([])} />);
    expect(screen.queryAllByTestId('map')).toEqual([]);
    expect(observed.length).toBe(40);

    const scrolledIn = { isIntersecting: true, target: observed[0] } as IntersectionObserverEntry;
    act(() => report([scrolledIn], {} as IntersectionObserver));
    expect(screen.getAllByTestId('map').length).toBeGreaterThan(0);
  });

  it('ignores a row that is reported but still out of view', () => {
    render(<SearchScreen queries={queriesFor([])} />);
    const offScreen = { isIntersecting: false, target: observed[0] } as IntersectionObserverEntry;
    act(() => report([offScreen], {} as IntersectionObserver));
    expect(screen.queryAllByTestId('map')).toEqual([]);
  });
});
