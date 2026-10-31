import { type SubmitEvent, useState } from 'react';
import type { Queries } from '../app/queries';
import { connectBackup, useBackupStatus } from '../backup';
import { today } from '../domain/date';
import { setBodyweight } from '../store';
import { formatKg, parseKg } from './format';

function BodyweightForm({ queries }: { queries: Queries }) {
  const current = queries.bodyweightKg(today());
  const [text, setText] = useState(current === null ? '' : formatKg(current));
  const kg = parseKg(text);
  const changed = kg !== null && kg > 0 && kg !== current;

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (changed) void setBodyweight(today(), kg);
  }

  return (
    <form className="settings-section" onSubmit={save}>
      <label className="settings-label" htmlFor="bodyweight">
        Bodyweight
      </label>
      <div className="settings-row">
        <input
          id="bodyweight"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="plain" disabled={!changed}>
          Save
        </button>
      </div>
    </form>
  );
}

function backupLine(state: string, lastBackupAt: number | null): string {
  if (state === 'syncing') return 'Backing up.';
  if (state === 'offline') return 'Offline. Backs up when you reconnect.';
  if (lastBackupAt === null) return 'No backup yet.';
  return `Last backup ${new Date(lastBackupAt).toLocaleString()}.`;
}

function BackupForm() {
  const { connected, state, lastBackupAt, error } = useBackupStatus();
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function connect(event: SubmitEvent) {
    event.preventDefault();
    if (!token.trim() || connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      await connectBackup(token);
      setToken('');
    } catch (cause) {
      setConnectError(cause instanceof Error ? cause.message : String(cause));
    }
    setConnecting(false);
  }

  return (
    <form className="settings-section" onSubmit={(event) => void connect(event)}>
      <label className="settings-label" htmlFor="token">
        Backup
      </label>
      {connected ? (
        <p className="hint">{backupLine(state, lastBackupAt)}</p>
      ) : (
        <p className="hint">
          Create a private GitHub repo named fitnotes-data and a token with Contents read and write
          on it, then paste the token here. An existing backup is restored.
        </p>
      )}
      {error && error !== connectError && <p className="error">{error}</p>}
      {connectError && <p className="error">{connectError}</p>}
      <div className="settings-row">
        <input
          id="token"
          type="password"
          placeholder={connected ? 'Paste a new token' : 'GitHub token'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <button type="submit" className="plain" disabled={!token.trim() || connecting}>
          Connect
        </button>
      </div>
    </form>
  );
}

export function SettingsScreen({ queries }: { queries: Queries }) {
  return (
    <div className="screen">
      <BodyweightForm queries={queries} />
      <BackupForm />
    </div>
  );
}
