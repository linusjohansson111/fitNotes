import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupStatus } from '../backup';
import { connectBackup } from '../backup';
import { today } from '../domain/date';
import { setBodyweight } from '../store';
import { SettingsScreen } from './SettingsScreen';
import { queriesFor } from './testing';

let status: BackupStatus;

vi.mock('../backup', () => ({
  connectBackup: vi.fn(async () => {}),
  useBackupStatus: () => status,
}));
vi.mock('../store', () => ({ setBodyweight: vi.fn(async () => {}) }));

const TOKEN = 'github_pat_secret';
const bodyweight = () => screen.getByLabelText('Bodyweight') as HTMLInputElement;
const token = () => screen.getByLabelText('Backup') as HTMLInputElement;
const connect = () => screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement;

beforeEach(() => {
  status = { connected: false, state: 'idle', lastBackupAt: null, error: null };
  vi.mocked(connectBackup).mockReset();
  vi.mocked(connectBackup).mockResolvedValue(undefined);
  vi.mocked(setBodyweight).mockClear();
});

afterEach(cleanup);

describe('bodyweight', () => {
  it('shows the current value', () => {
    render(<SettingsScreen queries={queriesFor([])} />);
    expect(bodyweight().value).toBe('80');
  });

  it('is blank when none is recorded', () => {
    render(<SettingsScreen queries={queriesFor([], { bodyweights: [] })} />);
    expect(bodyweight().value).toBe('');
  });

  it('saves for today, decimal comma included', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen queries={queriesFor([])} />);
    await user.clear(bodyweight());
    await user.type(bodyweight(), '74,5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setBodyweight).toHaveBeenCalledWith(today(), 74.5);
  });

  it('refuses a bodyweight that is not a positive number', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen queries={queriesFor([])} />);
    await user.clear(bodyweight());
    await user.type(bodyweight(), '0');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('AC2: backup', () => {
  it('asks for a token when not connected, as a password with autocomplete off', () => {
    render(<SettingsScreen queries={queriesFor([])} />);
    expect(screen.getByText(/private GitHub repo/)).toBeTruthy();
    expect(token().type).toBe('password');
    expect(token().autocomplete).toBe('off');
  });

  it('connects with the pasted token and clears the field', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen queries={queriesFor([])} />);
    await user.type(token(), TOKEN);
    await user.click(connect());
    expect(connectBackup).toHaveBeenCalledWith(TOKEN);
    expect(token().value).toBe('');
  });

  it('shows the error from connecting as given, and allows another try', async () => {
    vi.mocked(connectBackup).mockRejectedValueOnce(new Error('GitHub rejected the token. Paste a new one.'));
    const user = userEvent.setup();
    render(<SettingsScreen queries={queriesFor([])} />);
    await user.type(token(), TOKEN);
    await user.click(connect());
    expect(await screen.findByText('GitHub rejected the token. Paste a new one.')).toBeTruthy();
    expect(connect().disabled).toBe(false);
  });

  it('shows the error once when connecting and the status both report it', async () => {
    const message = 'GitHub rejected the token. Paste a new one.';
    vi.mocked(connectBackup).mockRejectedValueOnce(new Error(message));
    status = { ...status, connected: true, state: 'error', error: message };
    const user = userEvent.setup();
    render(<SettingsScreen queries={queriesFor([])} />);
    await user.type(token(), TOKEN);
    await user.click(connect());
    expect(await screen.findAllByText(message)).toHaveLength(1);
  });

  it('never prints the token', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsScreen queries={queriesFor([])} />);
    await user.type(token(), TOKEN);
    expect(container.textContent).not.toContain(TOKEN);
  });

  it('shows the last backup when connected', () => {
    const at = new Date(2026, 9, 1, 12, 30).getTime();
    status = { connected: true, state: 'idle', lastBackupAt: at, error: null };
    render(<SettingsScreen queries={queriesFor([])} />);
    expect(screen.getByText(`Last backup ${new Date(at).toLocaleString()}.`)).toBeTruthy();
    expect(screen.queryByText(/private GitHub repo/)).toBeNull();
  });

  it('shows a backup error and still accepts a new token, which is how a bad one is fixed', async () => {
    status = { connected: true, state: 'error', lastBackupAt: null, error: 'GitHub rejected the token. Paste a new one.' };
    const user = userEvent.setup();
    render(<SettingsScreen queries={queriesFor([])} />);
    expect(screen.getByText('GitHub rejected the token. Paste a new one.')).toBeTruthy();
    await user.type(token(), TOKEN);
    await user.click(connect());
    expect(connectBackup).toHaveBeenCalledWith(TOKEN);
  });

  it('says when it is offline', () => {
    status = { connected: true, state: 'offline', lastBackupAt: null, error: null };
    render(<SettingsScreen queries={queriesFor([])} />);
    expect(screen.getByText('Offline. Backs up when you reconnect.')).toBeTruthy();
  });
});
