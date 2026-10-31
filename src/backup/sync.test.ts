import 'fake-indexeddb/auto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomExercise, Entry, ExerciseDef } from '../domain/types';
import { FakeGithub } from './fake-github';
import type { BackupError, Snapshot } from './index';
import { emptySnapshot } from './merge';

interface App {
  backup: typeof import('./index');
  store: typeof import('../store');
}

const WEEK_MS = 7 * 86_400_000;

const CUSTOM: ExerciseDef = {
  id: 'custom-1',
  name: 'Bänkpress på lutande bänk',
  group: 'Chest',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  equipment: 'barbell',
};

const set = (date: string, weightKg = 80, reps = 8) => ({ exerciseId: 'bench', date, weightKg, reps });

let gh: FakeGithub;
let app: App;

/** Runs real macrotasks: fake-indexeddb needs them, and Promise chains drain in between. */
async function settle(turns = 200): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

/** The app closed and opened again: same device, new module state. */
async function reopenApp(): Promise<App> {
  app?.backup.stopBackup();
  await settle();
  vi.resetModules();
  const [backup, store] = [await import('./index'), await import('../store')];
  await store.readAll();
  return { backup, store };
}

/** Deleted and reinstalled: IndexedDB wiped and module state reset. */
async function freshInstall(): Promise<App> {
  app?.backup.stopBackup();
  await settle();
  vi.stubGlobal('indexedDB', new IDBFactory());
  return reopenApp();
}

function goOffline(): void {
  gh.offline = true;
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
}

function goOnline(): void {
  gh.offline = false;
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
}

function setVisibility(state: DocumentVisibilityState): void {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
}

function status(hook: { result: { current: unknown } }) {
  return hook.result.current as ReturnType<App['backup']['useBackupStatus']>;
}

function statusHook() {
  return renderHook(() => app.backup.useBackupStatus());
}

async function connect(): Promise<void> {
  await app.backup.connectBackup(gh.token);
  await settle();
}

/** A device that has already been connected and has settled. */
async function connected(): Promise<void> {
  await connect();
  await advance(0);
  gh.calls = [];
}

function backupRecords(snapshot: Snapshot) {
  return {
    entries: snapshot.entries,
    bodyweights: snapshot.bodyweights,
    customExercises: snapshot.customExercises,
    notes: snapshot.notes,
  };
}

beforeEach(async () => {
  // setImmediate stays real, as fake-indexeddb runs on it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(Date.UTC(2026, 9, 31, 12));
  gh = new FakeGithub();
  vi.stubGlobal('fetch', gh.fetch);
  vi.stubGlobal('indexedDB', new IDBFactory());
  app = undefined as unknown as App;
  app = await reopenApp();
});

afterEach(async () => {
  app.backup.stopBackup();
  await settle();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connectBackup', () => {
  it('stores the credentials, then backs up what is here', async () => {
    await app.store.addEntry(set('2026-10-01'));
    await connect();

    expect(await app.store.getMeta('credentials')).toEqual({ token: gh.token, owner: 'linus' });
    expect(gh.snapshot.entries).toHaveLength(1);
    expect(app.store.isDirty()).toBe(false);
  });

  it('accepts a token with stray whitespace from pasting', async () => {
    await app.backup.connectBackup(`  ${gh.token}\n`);
    expect(await app.store.getMeta('credentials')).toEqual({ token: gh.token, owner: 'linus' });
  });

  async function expectNothingStored(promise: Promise<void>, kind: string): Promise<BackupError> {
    const error = await promise.then(
      () => {
        throw new Error('Expected a rejection');
      },
      (reason: BackupError) => reason,
    );
    expect(error.name).toBe('BackupError');
    expect(error.kind).toBe(kind);
    expect(error.message.length).toBeGreaterThan(0);
    expect(await app.store.getMeta('credentials')).toBeUndefined();
    return error;
  }

  it('rejects a bad token and stores nothing', async () => {
    const hook = statusHook();
    await expectNothingStored(app.backup.connectBackup('github_pat_wrong'), 'auth');
    expect(status(hook).connected).toBe(false);
  });

  it('rejects a missing repo and stores nothing', async () => {
    gh.repoExists = false;
    await expectNothingStored(app.backup.connectBackup(gh.token), 'repo-not-found');
  });

  it('rejects when GitHub cannot be reached and stores nothing', async () => {
    gh.offline = true;
    await expectNothingStored(app.backup.connectBackup(gh.token), 'offline');
  });

  it('rejects a token that can see the repo but not its contents', async () => {
    const before = gh.fetch;
    let requests = 0;
    gh.fetch = (input, init) => {
      requests += 1;
      if (requests === 3) gh.failNext({ status: 403 });
      return before(input, init);
    };
    vi.stubGlobal('fetch', gh.fetch);
    await expectNothingStored(app.backup.connectBackup(gh.token), 'auth');
  });

  it('refuses an unreadable backup and leaves it untouched', async () => {
    gh.commit('this is not a backup');
    await app.store.addEntry(set('2026-10-01'));
    await expectNothingStored(app.backup.connectBackup(gh.token), 'bad-backup');
    expect(gh.text).toBe('this is not a backup');
    expect(gh.puts).toEqual([]);
  });
});

describe('AC2: backup without user action', () => {
  it('backs up offline writes on the online event', async () => {
    await connected();
    app.backup.startBackup();
    goOffline();
    await app.store.addEntry(set('2026-10-01'));
    await app.store.setBodyweight('2026-10-01', 80);
    await app.store.saveCustomExercise(CUSTOM);
    await app.store.setNote('bench', 'Elbows in');
    await advance(60_000);
    expect(gh.puts).toEqual([]);
    expect(app.store.isDirty()).toBe(true);

    goOnline();
    await settle();

    expect(gh.puts).toHaveLength(1);
    expect(gh.snapshot).toMatchObject({
      entries: [set('2026-10-01')],
      bodyweights: [{ date: '2026-10-01', kg: 80 }],
      customExercises: [{ id: CUSTOM.id, name: CUSTOM.name }],
      notes: [{ exerciseId: 'bench', note: 'Elbows in' }],
    });
    expect(app.store.isDirty()).toBe(false);
  });

  it('backs up writes left dirty by the last session when the app starts', async () => {
    goOffline();
    await app.store.addEntry(set('2026-10-01'));
    await app.store.setMeta('credentials', { token: gh.token, owner: gh.login });

    app = await reopenApp();
    gh.offline = false;
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    app.backup.startBackup();
    await settle();

    expect(gh.snapshot.entries).toHaveLength(1);
    expect(app.store.isDirty()).toBe(false);
  });

  it('keeps syncing after a restart without the token being pasted again', async () => {
    await connected();
    app = await reopenApp();
    app.backup.startBackup();
    await settle();
    await app.store.addEntry(set('2026-10-01'));
    await advance(10_000);
    expect(gh.snapshot.entries).toHaveLength(1);
  });
});

describe('AC2: restore on a fresh install', () => {
  async function populate(): Promise<{ kept: Entry; custom: CustomExercise }> {
    const kept = await app.store.addEntry(set('2026-10-01', 80, 8));
    const gone = await app.store.addEntry(set('2026-10-02', 85, 5));
    await app.store.deleteEntry(gone.id);
    await app.store.setBodyweight('2026-10-01', 80);
    await app.store.setBodyweight('2026-10-02', 81);
    await app.store.deleteBodyweight('2026-10-02');
    const custom = await app.store.saveCustomExercise(CUSTOM);
    await app.store.setNote('bench', 'Håll armbågarna nära');
    return { kept, custom };
  }

  it('restores every record and respects tombstones', async () => {
    const { kept, custom } = await populate();
    await connect();
    const remoteBefore = gh.text;
    const expected = app.store.getAppData();

    app = await freshInstall();
    expect(app.store.isEmpty()).toBe(true);
    gh.calls = [];
    await app.backup.connectBackup(gh.token);

    expect(app.store.getAppData()).toEqual(expected);
    expect(app.store.getAppData()).toMatchObject({
      entries: [{ id: kept.id }],
      bodyweights: [{ date: '2026-10-01', kg: 80 }],
      customExercises: [{ id: custom.id, name: CUSTOM.name }],
      notes: [{ exerciseId: 'bench', note: 'Håll armbågarna nära' }],
    });

    const all = await app.store.readAll();
    expect(all.entries).toHaveLength(2);
    expect(all.entries.filter((entry) => entry.deleted)).toHaveLength(1);
    expect(all.bodyweights.filter((record) => record.deleted)).toHaveLength(1);

    expect(app.store.isDirty()).toBe(false);
    expect(gh.puts).toEqual([]);
    expect(gh.text).toBe(remoteBefore);
  });

  it('shows restored records through useAppData with no extra step', async () => {
    await populate();
    await connect();
    app = await freshInstall();

    const hook = renderHook(() => app.store.useAppData());
    await act(async () => {
      await settle();
    });
    expect(hook.result.current?.entries).toEqual([]);

    await act(async () => {
      await app.backup.connectBackup(gh.token);
    });
    expect(hook.result.current?.entries).toHaveLength(1);
    expect(hook.result.current?.notes).toHaveLength(1);
  });

  it('survives a restart without the network after restoring', async () => {
    await populate();
    await connect();
    const expected = app.store.getAppData();

    app = await freshInstall();
    await app.backup.connectBackup(gh.token);
    goOffline();
    app = await reopenApp();
    expect(app.store.getAppData()).toEqual(expected);
  });

  it('keeps editing restored records in step with the remote', async () => {
    const { kept } = await populate();
    await connect();
    app = await freshInstall();
    await app.backup.connectBackup(gh.token);
    await settle();

    await app.store.updateEntry(kept.id, { reps: 9 });
    await advance(10_000);

    const live = gh.snapshot.entries.filter((entry) => !entry.deleted);
    expect(live).toMatchObject([{ id: kept.id, reps: 9 }]);
  });
});

describe('a device with few records never destroys the backup', () => {
  it('merges a fresh install holding a few offline entries, losing nothing on either side', async () => {
    const remote = await Promise.all([
      app.store.addEntry(set('2026-09-01')),
      app.store.addEntry(set('2026-09-02')),
      app.store.addEntry(set('2026-09-03')),
    ]);
    await app.store.setBodyweight('2026-09-01', 79);
    await app.store.setNote('squat', 'Deep');
    await connect();

    app = await freshInstall();
    const local = await app.store.addEntry(set('2026-10-01'));
    await app.store.setBodyweight('2026-10-01', 80);
    await app.store.setNote('bench', 'Elbows in');
    await app.backup.connectBackup(gh.token);

    const ids = [...remote, local].map((entry) => entry.id).sort();
    expect(gh.snapshot.entries.map((entry) => entry.id).sort()).toEqual(ids);
    expect(app.store.getAppData()?.entries.map((entry) => entry.id).sort()).toEqual(ids);
    for (const data of [gh.snapshot, app.store.getAppData()]) {
      expect(data?.bodyweights.map((record) => record.date)).toEqual(['2026-09-01', '2026-10-01']);
      expect(data?.notes.map((note) => note.exerciseId)).toEqual(['bench', 'squat']);
    }
    expect(app.store.isDirty()).toBe(false);
    expect(gh.puts.length).toBeGreaterThan(0);
  });

  it('never sends a PUT before reading the remote', async () => {
    await app.store.addEntry(set('2026-10-01'));
    await connect();
    await app.store.addEntry(set('2026-10-02'));
    await app.backup.connectBackup(gh.token);

    const firstPut = gh.calls.findIndex((call) => call.method === 'PUT');
    const firstRead = gh.calls.findIndex((call) => call.path.endsWith('/backup.json'));
    expect(firstRead).toBeLessThan(firstPut);
  });

  it('pushes nothing over a backup when a device starts empty', async () => {
    await app.store.addEntry(set('2026-10-01'));
    await connect();
    const remoteBefore = gh.text;

    app = await freshInstall();
    await app.store.setMeta('credentials', { token: gh.token, owner: gh.login });
    gh.calls = [];
    app.backup.startBackup();
    await settle();

    expect(gh.puts).toEqual([]);
    expect(gh.text).toBe(remoteBefore);
    expect(app.store.getAppData()?.entries).toHaveLength(1);
  });

  it('writes the first backup with no sha when the file does not exist', async () => {
    await app.store.addEntry(set('2026-10-01'));
    await connect();
    expect(JSON.parse(gh.puts[0].body ?? '{}')).not.toHaveProperty('sha');
  });

  it('makes no commit when connecting an empty device to an empty repo', async () => {
    await connect();
    expect(gh.puts).toEqual([]);
    expect(gh.text).toBeNull();
  });
});

describe('deletions', () => {
  it('survives a merge with an older copy on the other device', async () => {
    const entry = await app.store.addEntry(set('2026-10-01'));
    await connect();
    const olderCopy = gh.text ?? '';

    // This device deletes and backs up.
    await app.store.deleteEntry(entry.id);
    await app.backup.connectBackup(gh.token);
    expect(gh.snapshot.entries[0].deleted).toBe(true);

    // A second device, still holding the older copy, syncs afterwards.
    const deletedRemote = gh.text ?? '';
    gh.commit(olderCopy);
    app = await freshInstall();
    await app.backup.connectBackup(gh.token);
    expect(app.store.getAppData()?.entries).toHaveLength(1);

    gh.commit(deletedRemote);
    await app.backup.connectBackup(gh.token);
    expect(app.store.getAppData()?.entries).toEqual([]);
  });

  it('survives when the older copy is the remote', async () => {
    const entry = await app.store.addEntry(set('2026-10-01'));
    await connect();

    await app.store.deleteEntry(entry.id);
    await app.backup.connectBackup(gh.token);

    expect(app.store.getAppData()?.entries).toEqual([]);
    expect(gh.snapshot.entries).toMatchObject([{ id: entry.id, deleted: true }]);
  });

  it('lets an edit made after the deletion win', async () => {
    const entry = await app.store.addEntry(set('2026-10-01'));
    await connect();
    const live = gh.snapshot.entries[0];
    await app.store.deleteEntry(entry.id);
    await app.backup.connectBackup(gh.token);

    const later = (await app.store.readAll()).entries[0].updatedAt + 1;
    const revived = { ...live, reps: 12, updatedAt: later };
    gh.commit(JSON.stringify({ ...gh.snapshot, entries: [revived] }));
    await app.backup.connectBackup(gh.token);

    expect(app.store.getAppData()?.entries).toEqual([revived]);
  });
});

describe('sha conflicts', () => {
  const otherDevice = (reps: number): Entry => ({ ...set('2026-09-30', 50, reps), id: `other-${reps}`, updatedAt: 5 });

  function commitFromOtherDevice(entries: Entry[]): void {
    gh.commit(JSON.stringify({ ...gh.snapshot, entries: [...gh.snapshot.entries, ...entries] }));
  }

  it('re-reads, re-merges and keeps both sides after a 409', async () => {
    await app.store.setNote('bench', 'First backup');
    await connected();
    app.backup.startBackup();
    let interfered = false;
    gh.before = (call) => {
      if (call.method === 'PUT' && !interfered) {
        interfered = true;
        commitFromOtherDevice([otherDevice(1)]);
      }
    };

    const local = await app.store.addEntry(set('2026-10-01'));
    await advance(10_000);

    expect(gh.puts).toHaveLength(2);
    expect(gh.snapshot.entries.map((entry) => entry.id).sort()).toEqual([local.id, 'other-1'].sort());
    expect(app.store.getAppData()?.entries).toHaveLength(2);
    expect(app.store.isDirty()).toBe(false);
  });

  it('re-reads after a 422 when the file appeared after the read', async () => {
    await app.store.addEntry(set('2026-10-01'));
    let interfered = false;
    gh.before = (call) => {
      if (call.method === 'PUT' && !interfered) {
        interfered = true;
        gh.commit(JSON.stringify({ ...emptySnapshot(), entries: [otherDevice(2)] }));
      }
    };
    await connect();
    expect(gh.snapshot.entries).toHaveLength(2);
  });

  it('gives up after a bounded number of attempts and tries again later', async () => {
    await app.store.setNote('bench', 'First backup');
    await connected();
    app.backup.startBackup();
    await settle();
    const hook = statusHook();
    let round = 0;
    gh.before = (call) => {
      if (call.method === 'PUT') {
        round += 1;
        commitFromOtherDevice([otherDevice(round + 10)]);
      }
    };

    await act(async () => {
      await app.store.addEntry(set('2026-10-01'));
      await advance(3_000);
    });

    expect(gh.puts).toHaveLength(5);
    expect(status(hook)).toMatchObject({ state: 'error' });
    expect(app.store.isDirty()).toBe(true);

    gh.before = undefined;
    await act(async () => {
      await advance(60_000);
    });
    expect(status(hook)).toMatchObject({ state: 'idle', error: null });
    expect(app.store.isDirty()).toBe(false);
  });
});

describe('errors and the token', () => {
  it('stops after a 401 and reports it, with no retry loop', async () => {
    await connected();
    app.backup.startBackup();
    await settle();
    const hook = statusHook();
    gh.token = 'github_pat_rotated';
    gh.calls = [];

    await act(async () => {
      await app.store.addEntry(set('2026-10-01'));
      await advance(3_000);
    });
    expect(status(hook)).toMatchObject({ connected: true, state: 'error' });
    expect(status(hook).error).toContain('token');
    expect(gh.calls).toHaveLength(1);

    await act(async () => {
      await advance(WEEK_MS);
    });
    expect(gh.calls).toHaveLength(1);
    expect(app.store.isDirty()).toBe(true);
  });

  it('recovers once a new token is pasted', async () => {
    await connected();
    app.backup.startBackup();
    await settle();
    const hook = statusHook();
    gh.token = 'github_pat_rotated';
    await act(async () => {
      await app.store.addEntry(set('2026-10-01'));
      await advance(3_000);
    });
    expect(status(hook).state).toBe('error');

    await act(async () => {
      await app.backup.connectBackup('github_pat_rotated');
    });
    expect(status(hook)).toMatchObject({ connected: true, state: 'idle', error: null });
    expect(gh.snapshot.entries).toHaveLength(1);
  });

  it.each([
    ['repo not found', { status: 404 }, 'fitnotes-data'],
    ['no access', { status: 403 }, 'Contents read and write'],
  ])('does not loop on %s', async (_name, canned, reason) => {
    await connected();
    app.backup.startBackup();
    await settle();
    const hook = statusHook();
    gh.repoExists = canned.status !== 404;
    gh.failNext(canned);
    gh.calls = [];

    await act(async () => {
      await app.store.addEntry(set('2026-10-01'));
      await advance(3_000);
    });
    expect(status(hook).state).toBe('error');
    expect(status(hook).error).toContain(reason);
    const settled = gh.calls.length;

    await act(async () => {
      await advance(WEEK_MS);
    });
    expect(gh.calls).toHaveLength(settled);
  });

  it('reports a rate limit and retries with backoff', async () => {
    await connected();
    app.backup.startBackup();
    await settle();
    const hook = statusHook();
    gh.failNext({ status: 403, headers: { 'x-ratelimit-remaining': '0' } });

    await act(async () => {
      await app.store.addEntry(set('2026-10-01'));
      await advance(3_000);
    });
    expect(status(hook).state).toBe('error');
    expect(status(hook).error).toContain('rate limit');

    await act(async () => {
      await advance(20_000);
    });
    expect(status(hook)).toMatchObject({ state: 'idle', error: null });
    expect(gh.snapshot.entries).toHaveLength(1);
  });

  it('retries a server error while dirty', async () => {
    await connected();
    app.backup.startBackup();
    await settle();
    gh.failNext({ status: 502 });

    await app.store.addEntry(set('2026-10-01'));
    await advance(3_000);
    expect(gh.text).toBeNull();

    await advance(20_000);
    expect(gh.snapshot.entries).toHaveLength(1);
  });

  it('never exposes the token in the snapshot, backup.json, status or logs', async () => {
    const logged = vi.fn();
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(logged);
    }
    await app.store.addEntry(set('2026-10-01'));
    await app.store.setNote('bench', 'Elbows in');
    await connected();
    app.backup.startBackup();
    await settle();
    const hook = statusHook();

    await app.store.addEntry(set('2026-10-02'));
    await advance(10_000);
    const rawPut = gh.puts[0];
    gh.token = 'github_pat_rotated';
    await act(async () => {
      await app.store.addEntry(set('2026-10-03'));
      await advance(3_000);
    });

    const original = new FakeGithub().token;
    expect(rawPut.headers.authorization).toBe(`Bearer ${original}`);
    expect(rawPut.body).not.toContain(original);
    expect(gh.text).not.toContain(original);
    expect(JSON.stringify(gh.snapshot)).not.toContain('credentials');
    expect(JSON.stringify(await app.store.readAll())).not.toContain(original);
    expect(JSON.stringify(status(hook))).not.toContain(original);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(original);
  });
});

describe('triggers', () => {
  it('does nothing without credentials', async () => {
    app.backup.startBackup();
    await app.store.addEntry(set('2026-10-01'));
    window.dispatchEvent(new Event('online'));
    setVisibility('visible');
    await advance(WEEK_MS);
    expect(gh.calls).toEqual([]);
  });

  it('syncs on start', async () => {
    await connected();
    app.backup.stopBackup();
    app.backup.startBackup();
    await settle();
    expect(gh.calls.length).toBeGreaterThan(0);
  });

  it('wires triggers only once', async () => {
    await app.store.setNote('bench', 'First backup');
    await connected();
    app.backup.startBackup();
    app.backup.startBackup();
    app.backup.startBackup();
    await settle();
    gh.calls = [];

    window.dispatchEvent(new Event('online'));
    await settle();
    expect(gh.calls).toHaveLength(1);
  });

  it('syncs when the app becomes visible, but not hidden', async () => {
    await app.store.setNote('bench', 'First backup');
    await connected();
    app.backup.startBackup();
    await settle();
    gh.calls = [];

    setVisibility('hidden');
    await settle();
    expect(gh.calls).toEqual([]);

    setVisibility('visible');
    await settle();
    expect(gh.calls).toHaveLength(1);
  });

  it('pulls another device`s records when the app becomes visible', async () => {
    await connected();
    app.backup.startBackup();
    await settle();
    gh.commit(
      JSON.stringify({
        ...emptySnapshot(),
        entries: [{ ...set('2026-10-01'), id: 'other', updatedAt: 5 }],
      }),
    );

    setVisibility('visible');
    await settle();
    expect(app.store.getAppData()?.entries).toMatchObject([{ id: 'other' }]);
    expect(app.store.isDirty()).toBe(false);
  });

  it('turns a burst of writes into one PUT, a few seconds after the last', async () => {
    await connected();
    app.backup.startBackup();
    await settle();

    for (let i = 1; i <= 8; i++) {
      await app.store.addEntry(set(`2026-10-0${i}`));
      await advance(500);
    }
    expect(gh.puts).toEqual([]);

    await advance(10_000);
    expect(gh.puts).toHaveLength(1);
    expect(gh.snapshot.entries).toHaveLength(8);
    expect(app.store.isDirty()).toBe(false);
  });

  it('runs one sync at a time when triggers collide', async () => {
    await app.store.setNote('bench', 'Seed');
    await connected();
    app.backup.startBackup();
    await settle();

    let inFlight = 0;
    let peak = 0;
    const answer = gh.fetch;
    gh.fetch = async (input, init) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await settle(5);
      const response = await answer(input, init);
      inFlight -= 1;
      return response;
    };
    vi.stubGlobal('fetch', gh.fetch);
    await app.store.addEntry(set('2026-10-01'));

    window.dispatchEvent(new Event('online'));
    setVisibility('visible');
    window.dispatchEvent(new Event('online'));
    setVisibility('visible');
    await settle(2000);

    expect(peak).toBe(1);
    expect(gh.puts).toHaveLength(1);
    expect(gh.calls.length).toBeLessThanOrEqual(3);
  });

  it('runs a second pass for a write landing during a sync, and stays dirty until then', async () => {
    await connected();
    app.backup.startBackup();
    await settle();

    let lateWrite: Promise<Entry> | undefined;
    gh.before = async (call) => {
      if (call.method === 'PUT' && !lateWrite) lateWrite = app.store.addEntry(set('2026-10-02'));
      await lateWrite;
    };

    const first = await app.store.addEntry(set('2026-10-01'));
    await advance(3_000);
    const late = await (lateWrite as Promise<Entry>);

    expect(gh.puts).toHaveLength(1);
    expect(gh.snapshot.entries.map((entry) => entry.id)).toEqual([first.id]);
    expect(app.store.isDirty()).toBe(true);

    await advance(10_000);
    expect(gh.puts).toHaveLength(2);
    expect(gh.snapshot.entries.map((entry) => entry.id).sort()).toEqual([first.id, late.id].sort());
    expect(app.store.isDirty()).toBe(false);
  });

  it('keeps a write landing between the pull and the merge', async () => {
    await connected();
    let write: Promise<Entry> | undefined;
    gh.before = async (call) => {
      if (call.path.endsWith('/backup.json') && call.method === 'GET' && !write) {
        write = app.store.addEntry(set('2026-10-01', 100, 5));
        await write;
      }
    };

    await app.backup.connectBackup(gh.token);
    await advance(10_000);

    const entry = await (write as Promise<Entry>);
    expect(app.store.getAppData()?.entries).toEqual([entry]);
    expect(gh.snapshot.entries).toEqual([entry]);
    expect(app.store.isDirty()).toBe(false);
  });

  it('skips the PUT when the remote already has everything', async () => {
    await app.store.addEntry(set('2026-10-01'));
    await connect();
    const commits = gh.puts.length;
    const remoteBefore = gh.text;

    await app.backup.connectBackup(gh.token);
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(gh.puts).toHaveLength(commits);
    expect(gh.text).toBe(remoteBefore);
  });

  it('clears a dirty flag left when the app died after a PUT', async () => {
    await app.store.addEntry(set('2026-10-01'));
    await connect();
    await app.store.applySnapshot(backupRecords(gh.snapshot), { dirty: true });
    expect(app.store.isDirty()).toBe(true);

    gh.calls = [];
    await app.backup.connectBackup(gh.token);
    expect(gh.puts).toEqual([]);
    expect(app.store.isDirty()).toBe(false);
  });

  it('pushes when the merge has something the remote lacks, even if not dirty', async () => {
    await app.store.addEntry(set('2026-10-01'));
    await connect();
    gh.commit(JSON.stringify(emptySnapshot()));
    gh.calls = [];

    await app.backup.connectBackup(gh.token);
    expect(gh.puts).toHaveLength(1);
    expect(gh.snapshot.entries).toHaveLength(1);
    expect(app.store.isDirty()).toBe(false);
  });
});

describe('retry timer', () => {
  /** A failed push with GitHub unreachable. */
  async function failedPush(): Promise<void> {
    await connected();
    app.backup.startBackup();
    await settle();
    gh.offline = true;
    await app.store.addEntry(set('2026-10-01'));
    await advance(3_000);
    gh.calls = [];
  }

  it('backs off while dirty and visible', async () => {
    await failedPush();
    const times: number[] = [];
    const start = Date.now();
    gh.before = () => {
      times.push(Date.now() - start);
    };

    await advance(15_000);
    await advance(30_000);
    await advance(60_000);
    await advance(120_000);
    await advance(240_000);
    await advance(300_000);
    await advance(300_000);

    expect(times).toEqual([15_000, 45_000, 105_000, 225_000, 465_000, 765_000, 1_065_000]);
  });

  it('succeeds once GitHub is reachable, with no event', async () => {
    await failedPush();
    gh.offline = false;
    await advance(20_000);
    expect(gh.snapshot.entries).toHaveLength(1);
    expect(app.store.isDirty()).toBe(false);
  });

  it('does not fire while hidden', async () => {
    await failedPush();
    setVisibility('hidden');
    await advance(WEEK_MS);
    await settle();
    const whileHidden = gh.calls.length;
    expect(whileHidden).toBeLessThanOrEqual(1);

    await advance(WEEK_MS);
    expect(gh.calls).toHaveLength(whileHidden);
  });

  it('does not run when nothing is dirty', async () => {
    await connected();
    app.backup.startBackup();
    await settle();
    gh.offline = true;
    window.dispatchEvent(new Event('online'));
    await settle();
    gh.calls = [];

    await advance(WEEK_MS);
    expect(gh.calls).toEqual([]);
  });

  it('stops after a success', async () => {
    await failedPush();
    gh.offline = false;
    await advance(20_000);
    gh.calls = [];

    await advance(WEEK_MS);
    expect(gh.calls).toEqual([]);
  });
});

describe('offline', () => {
  it('stays silent and harmless', async () => {
    const consoleError = vi.spyOn(console, 'error');
    await connected();
    app.backup.startBackup();
    await settle();
    const hook = statusHook();
    goOffline();
    gh.calls = [];

    await act(async () => {
      const entry = await app.store.addEntry(set('2026-10-01'));
      await app.store.updateEntry(entry.id, { reps: 9 });
      await advance(60_000);
    });

    expect(gh.calls).toEqual([]);
    expect(status(hook)).toMatchObject({ connected: true, state: 'offline', error: null });
    expect(consoleError).not.toHaveBeenCalled();
    expect(app.store.getAppData()?.entries).toHaveLength(1);
  });

  it('reports offline when fetch fails though navigator says online', async () => {
    await connected();
    app.backup.startBackup();
    await settle();
    const hook = statusHook();
    gh.offline = true;

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await settle();
    });
    expect(status(hook)).toMatchObject({ state: 'offline', error: null });
  });
});

describe('useBackupStatus', () => {
  it('starts disconnected', () => {
    expect(status(statusHook())).toEqual({
      connected: false,
      state: 'idle',
      lastBackupAt: null,
      error: null,
    });
  });

  it('shows syncing, then idle with lastBackupAt', async () => {
    const hook = statusHook();
    const seen: string[] = [];
    gh.before = () => {
      seen.push(status(hook).state);
    };

    await act(async () => {
      await app.store.addEntry(set('2026-10-01'));
      await app.backup.connectBackup(gh.token);
      await settle();
    });

    expect(seen).toContain('syncing');
    expect(status(hook)).toEqual({
      connected: true,
      state: 'idle',
      lastBackupAt: Date.now(),
      error: null,
    });
  });

  it('is stable between changes', async () => {
    await connected();
    const hook = statusHook();
    const before = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(before);
  });

  it('remembers the connection and lastBackupAt across a restart', async () => {
    await app.store.addEntry(set('2026-10-01'));
    await connected();
    const backedUpAt = Date.now();

    goOffline();
    app = await reopenApp();
    app.backup.startBackup();
    await settle();
    await act(async () => {
      await settle();
    });

    expect(status(statusHook())).toMatchObject({ connected: true, lastBackupAt: backedUpAt });
  });
});
