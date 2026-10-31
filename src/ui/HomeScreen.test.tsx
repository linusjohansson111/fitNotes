import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupStatus } from '../backup';
import { HomeScreen } from './HomeScreen';
import { href } from './nav';
import { BENCH, PULLUP, SQUAT, entry, queriesFor } from './testing';

let status: BackupStatus;

vi.mock('../backup', () => ({ useBackupStatus: () => status }));

beforeEach(() => {
  status = { connected: false, state: 'idle', lastBackupAt: null, error: null };
});

afterEach(cleanup);

function row(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement;
}

describe('AC4: home', () => {
  const INCLINE = 'Incline_Dumbbell_Press';
  const queries = queriesFor([
    entry(SQUAT, 3, 100, 8),
    entry(BENCH, 2, 80, 4),
    entry(INCLINE, 1, 30, 11),
  ]);

  it('lists only logged exercises, groups in fixed order, most recent first', () => {
    render(<HomeScreen queries={queries} />);
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Chest', 'Legs']);
    const chest = screen.getByRole('heading', { name: 'Chest' }).closest('section') as HTMLElement;
    expect(
      within(chest)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('.row-name')?.textContent),
    ).toEqual([queries.exercise(INCLINE)?.name, queries.exercise(BENCH)?.name]);
  });

  it("shows each row's colour and next weight in that colour", () => {
    render(<HomeScreen queries={queries} />);
    const bench = row(queries.exercise(BENCH)!.name);
    expect(bench.getAttribute('data-colour')).toBe('red');
    expect(bench.querySelector('.row-next')?.textContent).toBe(String(queries.predict(BENCH, entryDay())?.red));
    expect(row(queries.exercise(SQUAT)!.name).getAttribute('data-colour')).toBe('yellow');
    expect(row(queries.exercise(INCLINE)!.name).getAttribute('data-colour')).toBe('green');
  });

  it('opens the log form from the row and the exercise from a separate target', () => {
    render(<HomeScreen queries={queries} />);
    const name = queries.exercise(BENCH)!.name;
    expect(screen.getByText(name).closest('a')?.getAttribute('href')).toBe(
      href({ name: 'log', exerciseId: BENCH }),
    );
    expect(screen.getByRole('link', { name: `${name} history` }).getAttribute('href')).toBe(
      href({ name: 'exercise', exerciseId: BENCH }),
    );
  });

  it('links to settings from the header', () => {
    render(<HomeScreen queries={queries} />);
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('#/settings');
  });

  it('AC12: marks a negative next weight as assistance', () => {
    const assisted = queriesFor([entry(PULLUP, 1, -30, 8), entry(PULLUP, 2, -30, 8)]);
    render(<HomeScreen queries={assisted} />);
    const next = row(assisted.exercise(PULLUP)!.name).querySelector('.row-next');
    expect(next?.textContent).toMatch(/^assistance−\d/);
  });

  it('shows one line, an add button and a restore link when nothing is logged', () => {
    render(<HomeScreen queries={queriesFor([])} />);
    expect(screen.getByText('Nothing logged yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add an exercise' }).getAttribute('href')).toBe('#/search');
    expect(screen.getByRole('link', { name: 'Restore from backup' }).getAttribute('href')).toBe('#/settings');
  });

  it('drops the restore link once backup is connected', () => {
    status = { ...status, connected: true };
    render(<HomeScreen queries={queriesFor([])} />);
    expect(screen.queryByRole('link', { name: 'Restore from backup' })).toBeNull();
  });
});

function entryDay(): string {
  return entry(BENCH, 0, 0, 1).date;
}
