import { useSyncExternalStore } from 'react';
import {
  applySnapshot,
  getMeta,
  isDirty,
  localRevision,
  markClean,
  onLocalWrite,
  readAll,
  setMeta,
} from '../store';
import { BackupError, GithubTarget, type BackupTarget } from './github';
import { emptySnapshot, merge, sameRecords, toSnapshot } from './merge';

export interface BackupStatus {
  connected: boolean;
  state: 'idle' | 'syncing' | 'offline' | 'error';
  lastBackupAt: number | null;
  error: string | null;
}

interface Credentials {
  token: string;
  owner: string;
}

const CREDENTIALS_KEY = 'credentials';
const LAST_BACKUP_KEY = 'lastBackupAt';
const DEBOUNCE_MS = 3_000;
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
const MAX_PUSH_ATTEMPTS = 5;

let status: BackupStatus = { connected: false, state: 'idle', lastBackupAt: null, error: null };
const statusListeners = new Set<() => void>();

let running: Promise<void> | null = null;
let runAgain = false;
let stopTriggers: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;

function setStatus(patch: Partial<BackupStatus>): void {
  const next = { ...status, ...patch };
  const keys = Object.keys(next) as (keyof BackupStatus)[];
  if (keys.every((key) => next[key] === status[key])) return;
  status = next;
  for (const listener of [...statusListeners]) listener();
}

/**
 * Pull, merge, then push. The push carries the sha of the version that was
 * merged, so a remote that moved in between is re-merged, never overwritten.
 */
export async function pullMergePush(target: BackupTarget): Promise<void> {
  // Read before the data: a write landing in between keeps the store dirty.
  const seenRevision = localRevision();
  for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
    const remote = await target.read();
    const base = remote?.snapshot ?? emptySnapshot();
    const merged = merge(toSnapshot(await readAll(), 0), base);
    const push = !sameRecords(merged, base);
    await applySnapshot(merged, { dirty: push });
    if (!push) return markClean(seenRevision);
    try {
      await target.write({ ...merged, exportedAt: Date.now() }, remote?.sha ?? null);
      return markClean(seenRevision);
    } catch (error) {
      if (!(error instanceof BackupError && error.kind === 'conflict')) throw error;
    }
  }
  throw new BackupError('conflict', 'The backup kept changing while saving. It will try again.');
}

function scheduleRetry(): void {
  if (!stopTriggers || retryTimer !== undefined) return;
  if (!isDirty() || document.visibilityState !== 'visible') return;
  const delay = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_MAX_MS);
  failures += 1;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    // Becoming visible syncs anyway, so nothing is lost by skipping this one.
    if (document.visibilityState === 'visible') trigger();
  }, delay);
}

function isPermanent(error: BackupError): boolean {
  return ['auth', 'repo-not-found', 'repo-public', 'bad-backup'].includes(error.kind);
}

async function runPass(): Promise<void> {
  try {
    const credentials = await getMeta<Credentials>(CREDENTIALS_KEY);
    if (!credentials) return;
    if (navigator.onLine === false) {
      throw new BackupError('offline', 'Cannot reach GitHub. Check the connection and try again.');
    }
    setStatus({ connected: true, state: 'syncing', error: null });
    await pullMergePush(new GithubTarget(credentials.token, credentials.owner));

    // Everything here was in the remote at this moment, whether or not a PUT was needed.
    const backedUpAt = Date.now();
    await setMeta(LAST_BACKUP_KEY, backedUpAt);
    failures = 0;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    setStatus({ state: 'idle', lastBackupAt: backedUpAt });
  } catch (cause) {
    const error =
      cause instanceof BackupError ? cause : new BackupError('unknown', 'Backup failed. It will try again.');
    if (error.kind === 'offline') setStatus({ state: 'offline', error: null });
    else setStatus({ state: 'error', error: error.message });
    if (!isPermanent(error)) scheduleRetry();
    throw error;
  }
}

async function runPasses(): Promise<void> {
  do {
    runAgain = false;
    await runPass();
  } while (runAgain);
}

/** Only one sync runs at once. A request during a run adds one more pass. */
function sync(): Promise<void> {
  if (running) {
    runAgain = true;
    return running;
  }
  running = runPasses().finally(() => {
    running = null;
  });
  return running;
}

/** For background triggers, where a failure only shows in the status. */
function trigger(): void {
  sync().catch(() => {});
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') trigger();
}

async function loadStatus(): Promise<void> {
  const [credentials, lastBackupAt] = await Promise.all([
    getMeta<Credentials>(CREDENTIALS_KEY),
    getMeta<number>(LAST_BACKUP_KEY),
  ]);
  setStatus({ connected: Boolean(credentials), lastBackupAt: lastBackupAt ?? null });
}

/**
 * Wires the triggers that back up without user action. iOS has no Background
 * Sync, so these only fire while the app is open. Safe to call more than once.
 */
export function startBackup(): void {
  if (stopTriggers) return;
  const offLocalWrite = onLocalWrite(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(trigger, DEBOUNCE_MS);
  });
  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', onVisibilityChange);
  stopTriggers = () => {
    offLocalWrite();
    window.removeEventListener('online', trigger);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    clearTimeout(debounceTimer);
    clearTimeout(retryTimer);
    retryTimer = undefined;
    stopTriggers = null;
  };
  loadStatus().then(trigger, () => {});
}

/** Removes the triggers. A sync already running still finishes. */
export function stopBackup(): void {
  stopTriggers?.();
}

/**
 * Connects this install and restores from the backup. Rejects with a
 * BackupError; nothing is stored unless the token can read the backup.
 */
export async function connectBackup(token: string): Promise<void> {
  const target = await GithubTarget.connect(token);
  await target.read();
  const credentials: Credentials = { token: target.token, owner: target.owner };
  await setMeta(CREDENTIALS_KEY, credentials);
  setStatus({ connected: true });
  startBackup();
  // A pass already running may be using older credentials, so it does not count.
  await running?.catch(() => {});
  await sync();
}

function subscribeStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function getStatus(): BackupStatus {
  return status;
}

export function useBackupStatus(): BackupStatus {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
}
