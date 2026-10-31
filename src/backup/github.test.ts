import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomExercise } from '../domain/types';
import { FakeGithub } from './fake-github';
import { BackupError, decodeBase64, encodeBase64, GithubTarget, type BackupErrorKind } from './github';
import { emptySnapshot, type Snapshot } from './merge';

const custom: CustomExercise = {
  id: 'custom-1',
  name: 'Bänkpress på lutande bänk 🏋️',
  group: 'Chest',
  primaryMuscles: ['chest'],
  secondaryMuscles: [],
  equipment: 'barbell',
  updatedAt: 1,
};

const withCustom: Snapshot = {
  ...emptySnapshot(),
  exportedAt: 1,
  customExercises: [custom],
  notes: [{ exerciseId: 'custom-1', note: 'Håll armbågarna nära. 肘を内側に', updatedAt: 1 }],
};

function kindOf(promise: Promise<unknown>): Promise<BackupErrorKind> {
  return promise.then(
    () => {
      throw new Error('Expected a rejection');
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(BackupError);
      return (error as BackupError).kind;
    },
  );
}

let gh: FakeGithub;
let target: GithubTarget;

beforeEach(() => {
  gh = new FakeGithub();
  vi.stubGlobal('fetch', gh.fetch);
  target = new GithubTarget(gh.token, gh.login);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('base64', () => {
  it('round-trips text that btoa alone cannot encode', () => {
    const text = 'å ä ö Å Ä Ö 🏋️ 肘';
    expect(() => btoa(text)).toThrow();
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('matches the standard UTF-8 encoding', () => {
    expect(encodeBase64('å')).toBe(Buffer.from('å', 'utf8').toString('base64'));
  });

  it('decodes GitHub base64, wrapped with newlines', () => {
    const wrapped = encodeBase64('fitNotes å'.repeat(50)).replace(/.{60}/g, '$&\n');
    expect(decodeBase64(wrapped)).toBe('fitNotes å'.repeat(50));
  });

  it('handles several megabytes without overflowing the call stack', () => {
    const text = 'å'.repeat(3_000_000);
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });
});

describe('requests', () => {
  it('sends no-store, a Bearer token and the API version on every request', async () => {
    await GithubTarget.connect(gh.token);
    await target.write(withCustom, null);
    await target.read();

    expect(gh.calls.length).toBeGreaterThanOrEqual(4);
    for (const call of gh.calls) {
      expect(call.cache).toBe('no-store');
      expect(call.headers.authorization).toBe(`Bearer ${gh.token}`);
      expect(call.headers['x-github-api-version']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('read', () => {
  it('returns null when the repo has no backup yet', async () => {
    expect(await target.read()).toBeNull();
  });

  it('tells a missing repo from a missing file', async () => {
    gh.repoExists = false;
    expect(await kindOf(target.read())).toBe('repo-not-found');
  });

  it('round-trips non-ASCII text through GitHub', async () => {
    await target.write(withCustom, null);
    const read = await target.read();
    expect(read?.snapshot.customExercises[0].name).toBe(custom.name);
    expect(read?.snapshot.notes[0].note).toBe(withCustom.notes[0].note);
  });

  it('reads a file over 1 MB, which GitHub returns with empty content', async () => {
    const large: Snapshot = {
      ...withCustom,
      entries: Array.from({ length: 12_000 }, (_, i) => ({
        id: `entry-${String(i).padStart(5, '0')}`,
        exerciseId: 'bänkpress',
        date: '2026-10-01',
        weightKg: 80,
        reps: 8,
        updatedAt: i + 1,
      })),
    };
    await target.write(large, null);
    expect(new TextEncoder().encode(gh.text ?? '').length).toBeGreaterThan(1024 * 1024);

    const read = await target.read();
    expect(read?.snapshot.entries).toHaveLength(12_000);
    expect(read?.snapshot.customExercises[0].name).toBe(custom.name);
    expect(gh.calls.at(-1)?.headers.accept).toBe('application/vnd.github.raw+json');
    expect(gh.calls.at(-1)?.path).toContain('/git/blobs/');
  });

  it('keeps the sha paired with the text it read for a large file', async () => {
    const large = (reps: number): Snapshot => ({
      ...emptySnapshot(),
      entries: Array.from({ length: 12_000 }, (_, i) => ({
        id: `entry-${String(i).padStart(5, '0')}`,
        exerciseId: 'bench',
        date: '2026-10-01',
        weightKg: 80,
        reps,
        updatedAt: 1,
      })),
    });
    await target.write(large(1), null);

    // Another device commits between the sha lookup and the content fetch.
    const committed = gh.text ?? '';
    gh.before = (call) => {
      if (call.path.includes('/git/blobs/')) gh.commit(JSON.stringify(large(2)));
    };
    const read = await target.read();
    gh.before = undefined;

    expect(read?.snapshot).toEqual(JSON.parse(committed));
    expect(await kindOf(target.write(emptySnapshot(), read?.sha ?? null))).toBe('conflict');
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['the wrong shape', JSON.stringify({ version: 1, entries: 'nope' })],
    ['an unknown version', JSON.stringify({ hello: 'world' })],
    ['a newer version', JSON.stringify({ ...emptySnapshot(), version: 2 })],
  ])('refuses %s', async (_name, text) => {
    gh.commit(text);
    expect(await kindOf(target.read())).toBe('bad-backup');
  });
});

describe('newer backups', () => {
  it('says the app needs updating', async () => {
    gh.commit(JSON.stringify({ ...emptySnapshot(), version: 2 }));
    await expect(target.read()).rejects.toThrow('newer app version');
  });
});

describe('write', () => {
  it('creates the file without a sha, then needs the current one', async () => {
    await target.write(emptySnapshot(), null);
    const first = await target.read();
    await target.write(withCustom, first?.sha ?? null);
    expect(gh.snapshot.customExercises).toEqual([custom]);
  });

  it('reports a stale sha as a conflict', async () => {
    await target.write(emptySnapshot(), null);
    expect(await kindOf(target.write(withCustom, 'stale'))).toBe('conflict');
  });

  it('reports a missing sha as a conflict', async () => {
    await target.write(emptySnapshot(), null);
    expect(await kindOf(target.write(withCustom, null))).toBe('conflict');
  });
});

describe('errors', () => {
  it.each<[string, Parameters<FakeGithub['failNext']>[0], BackupErrorKind]>([
    ['401', { status: 401 }, 'auth'],
    ['403 without access', { status: 403 }, 'auth'],
    ['403 primary rate limit', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }, 'rate-limit'],
    ['403 secondary rate limit', { status: 403, headers: { 'retry-after': '60' } }, 'rate-limit'],
    ['429', { status: 429 }, 'rate-limit'],
    ['500', { status: 500 }, 'server'],
    ['503', { status: 503 }, 'server'],
  ])('classifies %s', async (_name, canned, kind) => {
    gh.failNext(canned);
    expect(await kindOf(target.read())).toBe(kind);
  });

  it('classifies a rejected fetch as offline', async () => {
    gh.offline = true;
    expect(await kindOf(target.read())).toBe('offline');
  });

  it('never puts the token in a message', async () => {
    for (const status of [401, 403, 404, 429, 500]) {
      gh.failNext({ status });
      const message = await target.verifyRepo().then(
        () => 'resolved',
        (error: Error) => error.message,
      );
      expect(message).not.toBe('resolved');
      expect(message).not.toContain(gh.token);
    }
  });
});

describe('repo privacy', () => {
  function freshOwner(name: string): GithubTarget {
    gh.login = name;
    return new GithubTarget(gh.token, name);
  }

  it.each<[string, boolean | undefined]>([
    ['public', false],
    ['missing the private field', undefined],
  ])('refuses a repo that is %s', async (_name, repoPrivate) => {
    gh.repoPrivate = repoPrivate;
    expect(await kindOf(GithubTarget.connect(gh.token))).toBe('repo-public');
  });

  it('counts an unreadable repo reply as not private', async () => {
    const target = freshOwner('garbled');
    gh.failNext({ status: 200, body: 'not json' });
    expect(await kindOf(target.verifyRepo())).toBe('repo-public');
  });

  it('counts a repo reply of null as not private', async () => {
    const target = freshOwner('null-reply');
    gh.failNext({ status: 200, body: 'null' });
    expect(await kindOf(target.verifyRepo())).toBe('repo-public');
  });

  it('tells the user what to do', async () => {
    gh.repoPrivate = false;
    await expect(GithubTarget.connect(gh.token)).rejects.toThrow('Make it private');
  });

  it('refuses the first write to a public repo, sending no PUT', async () => {
    const target = freshOwner('public-owner');
    gh.repoPrivate = false;
    expect(await kindOf(target.write(withCustom, null))).toBe('repo-public');
    expect(gh.puts).toEqual([]);
    expect(gh.text).toBeNull();
  });

  it('keeps refusing while the repo stays public', async () => {
    const target = freshOwner('still-public');
    gh.repoPrivate = false;
    expect(await kindOf(target.write(withCustom, null))).toBe('repo-public');
    expect(await kindOf(target.write(withCustom, null))).toBe('repo-public');
    expect(gh.puts).toEqual([]);
  });

  it('refuses to read a backup-less public repo as simply empty', async () => {
    const target = freshOwner('empty-public');
    gh.repoPrivate = false;
    expect(await kindOf(target.read())).toBe('repo-public');
  });

  it('checks a private repo before every write', async () => {
    const target = freshOwner('private-owner');
    await target.write(emptySnapshot(), null);
    const first = await target.read();
    await target.write(withCustom, first?.sha ?? null);

    expect(gh.calls.filter((call) => call.path === `/repos/private-owner/fitnotes-data`)).toHaveLength(2);
    expect(gh.puts).toHaveLength(2);
  });

  it('checks again after a refusal, so a repo made private can resume', async () => {
    const target = freshOwner('fixed-owner');
    gh.repoPrivate = false;
    expect(await kindOf(target.write(withCustom, null))).toBe('repo-public');

    gh.repoPrivate = true;
    await target.write(withCustom, null);
    expect(gh.snapshot.customExercises).toEqual([custom]);
  });

  it('does not let one owner confirm another', async () => {
    await freshOwner('confirmed-owner').verifyRepo();
    const other = freshOwner('other-owner');
    gh.repoPrivate = false;
    expect(await kindOf(other.write(withCustom, null))).toBe('repo-public');
  });

  it('never reaches a PUT when the check cannot complete', async () => {
    const target = freshOwner('unreachable-owner');
    gh.offline = true;
    expect(await kindOf(target.write(withCustom, null))).toBe('offline');
    expect(gh.puts).toEqual([]);
  });
});

describe('connect', () => {
  it('resolves the owner from the token', async () => {
    expect((await GithubTarget.connect(gh.token)).owner).toBe('linus');
  });

  it('trims whitespace from a pasted token', async () => {
    const connected = await GithubTarget.connect(`  ${gh.token}\n`);
    expect(connected.token).toBe(gh.token);
  });

  it.each(['', '   ', 'two words', 'tökén'])('rejects %j without calling GitHub', async (token) => {
    expect(await kindOf(GithubTarget.connect(token))).toBe('auth');
    expect(gh.calls).toEqual([]);
  });

  it('rejects a bad token', async () => {
    expect(await kindOf(GithubTarget.connect('github_pat_wrong'))).toBe('auth');
  });

  it('rejects a missing repo', async () => {
    gh.repoExists = false;
    expect(await kindOf(GithubTarget.connect(gh.token))).toBe('repo-not-found');
  });
});
