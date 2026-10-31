import type { Snapshot } from './merge';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const REPO = 'fitnotes-data';
const FILE = 'backup.json';
const JSON_MEDIA = 'application/vnd.github+json';
const RAW_MEDIA = 'application/vnd.github.raw+json';
// A fetch that never settles would hold the single sync slot for the whole session.
const REQUEST_TIMEOUT_MS = 30_000;
// String.fromCharCode(...bytes) overflows the argument limit on a whole backup.
const BASE64_CHUNK = 0x8000;

export type BackupErrorKind =
  | 'auth'
  | 'repo-not-found'
  | 'repo-public'
  | 'offline'
  | 'rate-limit'
  | 'conflict'
  | 'bad-backup'
  | 'server'
  | 'unknown';

/** Failure with a message that is safe to show. It never contains the token. */
export class BackupError extends Error {
  readonly kind: BackupErrorKind;

  constructor(kind: BackupErrorKind, message: string) {
    super(message);
    this.name = 'BackupError';
    this.kind = kind;
  }
}

export interface BackupTarget {
  read(): Promise<{ snapshot: Snapshot; sha: string } | null>;
  /** `sha` is null when no backup exists yet. Rejects with kind 'conflict' if the remote moved. */
  write(snapshot: Snapshot, sha: string | null): Promise<void>;
}

interface Reply {
  ok: boolean;
  status: number;
  headers: Headers;
  body: string;
}

interface ContentsFile {
  sha: string;
  encoding: string;
  content: string;
}

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function decodeBase64(base64: string): string {
  const bytes = Uint8Array.from(atob(base64.replace(/\s/g, '')), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isRateLimited({ status, headers }: Reply): boolean {
  if (status === 429) return true;
  return status === 403 && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after'));
}

function failure(reply: Reply): BackupError {
  if (isRateLimited(reply)) {
    return new BackupError('rate-limit', "GitHub's rate limit was reached. Backup will try again later.");
  }
  switch (reply.status) {
    case 401:
      return new BackupError('auth', 'GitHub rejected the token. Paste a new one.');
    case 403:
      return new BackupError('auth', `The token has no access to ${REPO}. It needs Contents read and write.`);
    case 404:
      return new BackupError('repo-not-found', `The private repo ${REPO} was not found.`);
    default:
      return new BackupError('server', `GitHub returned an error (${reply.status}). Backup will try again.`);
  }
}

async function call(
  token: string,
  path: string,
  { method = 'GET', accept = JSON_MEDIA, body }: { method?: string; accept?: string; body?: string } = {},
): Promise<Reply> {
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      body,
      // API responses are cacheable for 60 seconds, and a stale sha means a 409.
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      body: await response.text(),
    };
  } catch {
    throw new BackupError('offline', 'Cannot reach GitHub. Check the connection and try again.');
  }
}

/** Anything but an explicit `private: true` counts as public. */
function isPrivate(repoBody: string): boolean {
  try {
    return (JSON.parse(repoBody) as { private?: unknown }).private === true;
  } catch {
    return false;
  }
}

function parseSnapshot(text: string): Snapshot {
  let data: Partial<Snapshot>;
  try {
    data = JSON.parse(text) as Partial<Snapshot>;
  } catch {
    throw new BackupError('bad-backup', `${FILE} could not be read, so it was left untouched.`);
  }
  if (typeof data?.version === 'number' && data.version > 1) {
    throw new BackupError('bad-backup', `${FILE} is from a newer app version, so it was left untouched.`);
  }
  const lists = [data?.entries, data?.bodyweights, data?.customExercises, data?.notes];
  if (data?.version !== 1 || !lists.every(Array.isArray)) {
    throw new BackupError('bad-backup', `${FILE} could not be read, so it was left untouched.`);
  }
  return data as Snapshot;
}

/** Keeps the backup in `backup.json` in the user's private fitnotes-data repo. */
export class GithubTarget implements BackupTarget {
  readonly token: string;
  readonly owner: string;

  constructor(token: string, owner: string) {
    this.token = token;
    this.owner = owner;
  }

  /** Resolves the owner from the token and verifies the repo. */
  static async connect(rawToken: string): Promise<GithubTarget> {
    const token = rawToken.trim();
    // fetch rejects an invalid header value, which would read as being offline.
    if (!/^[\x21-\x7e]+$/.test(token)) {
      throw new BackupError('auth', 'That does not look like a GitHub token. Paste it again.');
    }
    const user = await call(token, '/user');
    if (!user.ok) throw failure(user);
    const target = new GithubTarget(token, (JSON.parse(user.body) as { login: string }).login);
    await target.verifyRepo();
    return target;
  }

  private get repoPath(): string {
    return `/repos/${encodeURIComponent(this.owner)}/${REPO}`;
  }

  /** Rejects unless the repo exists and is private: the backup holds training and body data. */
  async verifyRepo(): Promise<void> {
    const repo = await call(this.token, this.repoPath);
    if (!repo.ok) throw failure(repo);
    if (!isPrivate(repo.body)) {
      throw new BackupError(
        'repo-public',
        `The repo ${REPO} is not private, so nothing was backed up. Make it private on GitHub and try again.`,
      );
    }
  }

  async read(): Promise<{ snapshot: Snapshot; sha: string } | null> {
    const reply = await call(this.token, `${this.repoPath}/contents/${FILE}`);
    if (reply.status === 404) {
      // GitHub answers 404 for a missing file and a missing repo alike.
      await this.verifyRepo();
      return null;
    }
    if (!reply.ok) throw failure(reply);
    const file = JSON.parse(reply.body) as ContentsFile;
    const text = file.encoding === 'base64' ? decodeBase64(file.content) : await this.readBlob(file.sha);
    return { snapshot: parseSnapshot(text), sha: file.sha };
  }

  /**
   * Over 1 MB the contents API returns the sha with empty content. A blob is
   * addressed by that sha, so the text always pairs with it: fetching the raw
   * file separately could return a newer version and overwrite it unmerged.
   */
  private async readBlob(sha: string): Promise<string> {
    const reply = await call(this.token, `${this.repoPath}/git/blobs/${sha}`, { accept: RAW_MEDIA });
    if (!reply.ok) throw failure(reply);
    return reply.body;
  }

  async write(snapshot: Snapshot, sha: string | null): Promise<void> {
    // Checked every time: iOS can keep the app alive for days, and the repo can go public meanwhile.
    await this.verifyRepo();
    const reply = await call(this.token, `${this.repoPath}/contents/${FILE}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Backup ${new Date(snapshot.exportedAt).toISOString()}`,
        content: encodeBase64(JSON.stringify(snapshot, null, 2)),
        ...(sha ? { sha } : {}),
      }),
    });
    // 409 is a stale sha. 422 is a missing one: the file appeared after the read.
    if (reply.status === 409 || reply.status === 422) {
      throw new BackupError('conflict', 'The backup kept changing while saving. It will try again.');
    }
    if (!reply.ok) throw failure(reply);
  }
}
