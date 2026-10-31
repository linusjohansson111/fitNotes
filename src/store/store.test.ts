import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseDef } from '../domain/types';

type Store = typeof import('./index');

const PRESS: ExerciseDef = {
  id: 'custom-press',
  name: 'Landmine press',
  group: 'Shoulders',
  primaryMuscles: ['front-deltoids'],
  secondaryMuscles: ['triceps'],
  equipment: 'barbell',
};

/** A new module instance over the same database, as after closing and reopening the app. */
async function reopenApp(): Promise<Store> {
  vi.resetModules();
  return import('./index');
}

/** Waits for the load so that synchronous reads see the data. */
async function loaded(store: Store): Promise<Store> {
  await store.readAll();
  return store;
}

let store: Store;

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  store = await reopenApp();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('actions', () => {
  it('adds, updates and tombstones an entry', async () => {
    const entry = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.getAppData()?.entries).toEqual([entry]);

    await store.updateEntry(entry.id, { reps: 9 });
    expect(store.getAppData()?.entries[0]).toMatchObject({ id: entry.id, weightKg: 80, reps: 9 });

    await store.deleteEntry(entry.id);
    expect(store.getAppData()?.entries).toEqual([]);
    const all = await store.readAll();
    expect(all.entries).toHaveLength(1);
    expect(all.entries[0]).toMatchObject({ id: entry.id, deleted: true });
  });

  it('rejects an update of a missing or deleted entry and treats a repeat delete as done', async () => {
    const entry = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });
    await store.deleteEntry(entry.id);
    const { updatedAt } = (await store.readAll()).entries[0];

    await expect(store.updateEntry(entry.id, { reps: 5 })).rejects.toThrow('No entry');
    await expect(store.updateEntry('nope', { reps: 5 })).rejects.toThrow('No entry');
    await store.deleteEntry(entry.id);
    await store.deleteEntry('nope');
    expect((await store.readAll()).entries[0].updatedAt).toBe(updatedAt);
  });

  it('keeps one bodyweight per date and lets a new value replace a tombstone', async () => {
    await store.setBodyweight('2026-10-01', 80);
    await store.setBodyweight('2026-10-01', 81);
    expect(store.getAppData()?.bodyweights).toMatchObject([{ date: '2026-10-01', kg: 81 }]);

    await store.deleteBodyweight('2026-10-01');
    expect(store.getAppData()?.bodyweights).toEqual([]);

    await store.setBodyweight('2026-10-01', 82);
    const [record] = store.getAppData()?.bodyweights ?? [];
    expect(record).toMatchObject({ kg: 82 });
    expect(record.deleted).toBeUndefined();
  });

  it('saves a custom exercise, storing only its definition', async () => {
    const withExtras = { ...PRESS, colour: 'red', note: 'not part of the definition' };
    const saved = await store.saveCustomExercise(withExtras);
    expect(saved).toEqual({ ...PRESS, updatedAt: saved.updatedAt });

    const edited = await store.saveCustomExercise({ ...PRESS, name: 'Viking press' });
    expect(store.getAppData()?.customExercises).toEqual([edited]);
  });

  it('gives a custom exercise an id when it has none', async () => {
    const saved = await store.saveCustomExercise({ ...PRESS, id: '' });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps one note per exercise', async () => {
    await store.setNote('bench', 'Elbows in');
    await store.setNote('bench', 'Pause at the chest');
    expect(store.getAppData()?.notes).toMatchObject([{ exerciseId: 'bench', note: 'Pause at the chest' }]);
  });

  it('keeps data across a restart', async () => {
    const entry = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });
    await store.setBodyweight('2026-10-01', 80);
    await store.saveCustomExercise(PRESS);
    await store.setNote('bench', 'Elbows in');
    const before = store.getAppData();

    const reopened = await loaded(await reopenApp());
    expect(reopened.getAppData()).toEqual(before);
    expect(reopened.getAppData()?.entries).toEqual([entry]);
  });

  it('serialises concurrent patches so neither is lost', async () => {
    const entry = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });
    await Promise.all([store.updateEntry(entry.id, { weightKg: 90 }), store.updateEntry(entry.id, { reps: 5 })]);
    expect(store.getAppData()?.entries[0]).toMatchObject({ weightKg: 90, reps: 5 });
  });

  it('reports empty only when no live record exists', async () => {
    expect(store.isEmpty()).toBe(true);
    await store.readAll();
    expect(store.isEmpty()).toBe(true);

    const entry = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });
    expect(store.isEmpty()).toBe(false);

    await store.deleteEntry(entry.id);
    expect(store.isEmpty()).toBe(true);
  });
});

describe('updatedAt', () => {
  it('strictly increases within one millisecond', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const stamps = [];
    for (let i = 0; i < 5; i++) {
      const entry = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: i + 1 });
      stamps.push(entry.updatedAt);
    }
    expect(stamps).toEqual([1_000_000, 1_000_001, 1_000_002, 1_000_003, 1_000_004]);
  });

  it('never goes backwards when the device clock does', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(5_000);
    const first = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });

    const reopened = await loaded(await reopenApp());
    vi.setSystemTime(1_000);
    const second = await reopened.addEntry({ exerciseId: 'bench', date: '2026-10-02', weightKg: 80, reps: 8 });
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });

  it('stays ahead of a restored record stamped by a device with a fast clock', async () => {
    const future = Date.now() + 86_400_000;
    await store.applySnapshot(
      {
        entries: [{ id: 'a', exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8, updatedAt: future }],
        bodyweights: [],
        customExercises: [],
        notes: [],
      },
      { dirty: false },
    );

    await store.updateEntry('a', { reps: 9 });
    const [entry] = (await store.readAll()).entries;
    expect(entry.reps).toBe(9);
    expect(entry.updatedAt).toBeGreaterThan(future);
  });
});

describe('dirty flag', () => {
  it('is set by every kind of write and survives a restart', async () => {
    const writes: (() => Promise<unknown>)[] = [
      () => store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 }),
      () => store.setBodyweight('2026-10-01', 80),
      () => store.deleteBodyweight('2026-10-01'),
      () => store.saveCustomExercise(PRESS),
      () => store.setNote('bench', 'Elbows in'),
    ];
    for (const write of writes) {
      store = await loaded(await reopenApp());
      await store.markClean(store.localRevision());
      expect(store.isDirty()).toBe(false);

      await write();
      expect(store.isDirty()).toBe(true);
      store = await loaded(await reopenApp());
      expect(store.isDirty()).toBe(true);
    }
  });

  it('is not cleared when a write landed after the revision was read', async () => {
    await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });
    const seen = store.localRevision();
    await store.addEntry({ exerciseId: 'bench', date: '2026-10-02', weightKg: 80, reps: 8 });

    await store.markClean(seen);
    expect(store.isDirty()).toBe(true);

    await store.markClean(store.localRevision());
    expect(store.isDirty()).toBe(false);
    expect((await loaded(await reopenApp())).isDirty()).toBe(false);
  });
});

describe('useAppData', () => {
  it('is null until loaded, then stable between changes, without tombstones', async () => {
    const seeded = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });
    store = await reopenApp();

    const { result, rerender } = renderHook(() => store.useAppData());
    expect(result.current).toBeNull();

    await waitFor(() => expect(result.current).not.toBeNull());
    const first = result.current;
    expect(first?.entries).toEqual([seeded]);
    rerender();
    expect(result.current).toBe(first);

    await act(async () => {
      await store.deleteEntry(seeded.id);
    });
    expect(result.current).not.toBe(first);
    expect(result.current?.entries).toEqual([]);
  });

  it('rebuilds only the collection that changed', async () => {
    await store.setBodyweight('2026-10-01', 80);
    const before = store.getAppData();
    await store.setNote('bench', 'Elbows in');
    const after = store.getAppData();
    expect(after?.bodyweights).toBe(before?.bodyweights);
    expect(after?.notes).not.toBe(before?.notes);
  });

  it('returns entries in date order, oldest first', async () => {
    await store.addEntry({ exerciseId: 'bench', date: '2026-10-03', weightKg: 80, reps: 8 });
    await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });
    await store.addEntry({ exerciseId: 'bench', date: '2026-10-02', weightKg: 80, reps: 8 });
    expect(store.getAppData()?.entries.map((entry) => entry.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });
});

describe('applySnapshot', () => {
  const entry = { id: 'a', exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8, updatedAt: 100 };
  const empty = { entries: [], bodyweights: [], customExercises: [], notes: [] };

  it('notifies subscribers without marking the store dirty', async () => {
    const listener = vi.fn();
    store.subscribe(listener);
    await store.applySnapshot({ ...empty, entries: [entry] }, { dirty: false });

    expect(listener).toHaveBeenCalled();
    expect(store.getAppData()?.entries).toEqual([entry]);
    expect(store.isDirty()).toBe(false);
    expect((await loaded(await reopenApp())).getAppData()?.entries).toEqual([entry]);
  });

  it('marks the store dirty on request and leaves an existing flag alone otherwise', async () => {
    await store.applySnapshot({ ...empty, entries: [entry] }, { dirty: true });
    expect(store.isDirty()).toBe(true);
    await store.applySnapshot(empty, { dirty: false });
    expect(store.isDirty()).toBe(true);
  });

  it('does not notify or rebuild when nothing changes', async () => {
    await store.applySnapshot({ ...empty, entries: [entry] }, { dirty: false });
    const before = store.getAppData();
    const listener = vi.fn();
    store.subscribe(listener);

    await store.applySnapshot({ ...empty, entries: [{ ...entry }] }, { dirty: false });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getAppData()).toBe(before);
  });

  it('never replaces a newer local record with an older merged one', async () => {
    const local = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 100, reps: 5 });
    const stale = { ...local, weightKg: 1, updatedAt: local.updatedAt - 1 };
    await store.applySnapshot({ ...empty, entries: [stale] }, { dirty: false });
    expect(store.getAppData()?.entries).toEqual([local]);
  });

  it('removes a record when a newer tombstone arrives', async () => {
    const local = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 100, reps: 5 });
    const tombstone = { ...local, deleted: true, updatedAt: local.updatedAt + 1 };
    await store.applySnapshot({ ...empty, entries: [tombstone] }, { dirty: false });
    expect(store.getAppData()?.entries).toEqual([]);
    expect((await store.readAll()).entries).toEqual([tombstone]);
  });

  it('applies everything or nothing', async () => {
    const bad = { date: '2026-10-01', kg: 80, updatedAt: 1, fn: () => {} };
    await expect(
      store.applySnapshot({ ...empty, entries: [entry], bodyweights: [bad] }, { dirty: false }),
    ).rejects.toThrow();
    expect((await loaded(await reopenApp())).getAppData()?.entries).toEqual([]);
  });
});

describe('meta', () => {
  it('round-trips values, kept out of readAll', async () => {
    await store.setMeta('credentials', { token: 'secret', owner: 'linus' });
    expect(await store.getMeta('credentials')).toEqual({ token: 'secret', owner: 'linus' });
    expect(await store.getMeta('missing')).toBeUndefined();
    expect(JSON.stringify(await store.readAll())).not.toContain('secret');
  });
});

describe('iOS traps', () => {
  /** Captures the raw connection the store opens. */
  function captureConnection(): () => IDBDatabase {
    const open = indexedDB.open.bind(indexedDB);
    let request: IDBOpenDBRequest | undefined;
    vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
      request = open(name, version);
      return request;
    });
    return () => (request as IDBOpenDBRequest).result;
  }

  it('reopens a connection killed mid-session and completes the next action', async () => {
    const connection = captureConnection();
    await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });
    expect(indexedDB.open).toHaveBeenCalledTimes(1);

    connection().close();

    await store.addEntry({ exerciseId: 'bench', date: '2026-10-02', weightKg: 80, reps: 8 });
    expect(indexedDB.open).toHaveBeenCalledTimes(2);
    expect(store.getAppData()?.entries).toHaveLength(2);
    expect((await loaded(await reopenApp())).getAppData()?.entries).toHaveLength(2);
  });

  it('reopens after the browser reports the connection closed', async () => {
    const connection = captureConnection();
    await store.setBodyweight('2026-10-01', 80);

    forceCloseDatabase(connection() as unknown as typeof IDBDatabase);

    await store.setBodyweight('2026-10-02', 81);
    expect(indexedDB.open).toHaveBeenCalledTimes(2);
    expect(store.getAppData()?.bodyweights).toHaveLength(2);
  });

  it('keeps its retry for a failed reopen when the browser reports the close', async () => {
    const connection = captureConnection();
    await store.setBodyweight('2026-10-01', 80);

    forceCloseDatabase(connection() as unknown as typeof IDBDatabase);
    vi.mocked(indexedDB.open).mockImplementationOnce(() => {
      throw new DOMException('Connection lost', 'UnknownError');
    });

    await store.setBodyweight('2026-10-02', 81);
    expect(store.getAppData()?.bodyweights).toHaveLength(2);
  });

  it('rejects and leaves memory unchanged when the retry also fails', async () => {
    await store.setBodyweight('2026-10-01', 80);
    const before = store.getAppData();
    const connectionLost = new DOMException('Connection lost', 'UnknownError');
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw connectionLost;
    });

    await expect(store.setBodyweight('2026-10-02', 81)).rejects.toBe(connectionLost);
    expect(store.getAppData()).toBe(before);
    expect(store.isDirty()).toBe(true);
  });

  it('calls navigator.storage.persist once', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { ...navigator, storage: { persist } });
    store = await reopenApp();
    await store.setBodyweight('2026-10-01', 80);
    await store.setBodyweight('2026-10-02', 81);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('tolerates persist being absent or failing', async () => {
    vi.stubGlobal('navigator', { ...navigator, storage: undefined });
    store = await reopenApp();
    await store.setBodyweight('2026-10-01', 80);

    vi.stubGlobal('navigator', {
      ...navigator,
      storage: { persist: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    store = await reopenApp();
    await store.setBodyweight('2026-10-02', 81);
    expect(store.getAppData()?.bodyweights).toHaveLength(2);
  });
});

describe('AC1: offline', () => {
  it('runs every action without the network', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Load failed'));
    vi.stubGlobal('fetch', fetchMock);

    const entry = await store.addEntry({ exerciseId: 'bench', date: '2026-10-01', weightKg: 80, reps: 8 });
    await store.updateEntry(entry.id, { reps: 9 });
    await store.deleteEntry(entry.id);
    await store.addEntry({ exerciseId: 'bench', date: '2026-10-02', weightKg: 82, reps: 8 });
    await store.setBodyweight('2026-10-01', 80);
    await store.deleteBodyweight('2026-10-01');
    await store.setBodyweight('2026-10-02', 81);
    await store.saveCustomExercise(PRESS);
    await store.setNote('bench', 'Elbows in');

    expect(store.getAppData()).toMatchObject({
      entries: [{ date: '2026-10-02', weightKg: 82 }],
      bodyweights: [{ date: '2026-10-02', kg: 81 }],
      customExercises: [{ id: PRESS.id }],
      notes: [{ exerciseId: 'bench', note: 'Elbows in' }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
