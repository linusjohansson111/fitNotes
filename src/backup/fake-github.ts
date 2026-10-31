import { createHash } from 'node:crypto';
import { decodeBase64, encodeBase64 } from './github';
import type { Snapshot } from './merge';

/** Test double: the parts of the GitHub REST API the backup uses. Never imported by the app. */

const MAX_INLINE_BYTES = 1024 * 1024;

export interface FakeCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  cache: RequestCache | undefined;
  body: string | undefined;
}

type Canned = { status: number; headers?: Record<string, string>; body?: string };

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function blobSha(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export class FakeGithub {
  token = 'github_pat_fake_token';
  login = 'linus';
  repoExists = true;
  /** undefined leaves the field out of the reply. */
  repoPrivate: boolean | undefined = true;
  offline = false;
  calls: FakeCall[] = [];
  /** Runs before a request is answered: the place to interleave another device or a local write. */
  before?: (call: FakeCall) => void | Promise<void>;

  private file: { text: string; sha: string } | null = null;
  private blobs = new Map<string, string>();
  private canned: Canned[] = [];

  /** The next requests, except GET /user, fail with this reply. */
  failNext(canned: Canned, times = 1): void {
    for (let i = 0; i < times; i++) this.canned.push(canned);
  }

  /** What another device's commit would do. */
  commit(text: string): void {
    const sha = blobSha(text);
    this.file = { text, sha };
    this.blobs.set(sha, text);
  }

  get text(): string | null {
    return this.file?.text ?? null;
  }

  get snapshot(): Snapshot {
    if (!this.file) throw new Error('No backup.json');
    return JSON.parse(this.file.text) as Snapshot;
  }

  get puts(): FakeCall[] {
    return this.calls.filter((call) => call.method === 'PUT');
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const call: FakeCall = {
      method: init.method ?? 'GET',
      path: url.pathname,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      cache: init.cache,
      body: typeof init.body === 'string' ? init.body : undefined,
    };
    this.calls.push(call);
    await this.before?.(call);
    if (this.offline) throw new TypeError('Load failed');
    if (call.headers.authorization !== `Bearer ${this.token}`) {
      return reply(401, { message: 'Bad credentials' });
    }
    if (call.path === '/user') return reply(200, { login: this.login });

    const canned = this.canned.shift();
    if (canned) return reply(canned.status, canned.body ?? { message: 'Canned' }, canned.headers);
    return this.route(call);
  };

  private route(call: FakeCall): Response {
    const repo = `/repos/${this.login}/fitnotes-data`;
    if (!call.path.startsWith(repo) || !this.repoExists) return reply(404, { message: 'Not Found' });
    if (call.path === repo) return reply(200, { name: 'fitnotes-data', private: this.repoPrivate });
    if (call.path.startsWith(`${repo}/git/blobs/`)) return this.getBlob(call);
    if (call.path === `${repo}/contents/backup.json`) {
      return call.method === 'PUT' ? this.putContents(call) : this.getContents();
    }
    return reply(404, { message: 'Not Found' });
  }

  private getContents(): Response {
    if (!this.file) return reply(404, { message: 'Not Found' });
    const { text, sha } = this.file;
    if (Buffer.byteLength(text, 'utf8') > MAX_INLINE_BYTES) {
      return reply(200, { name: 'backup.json', sha, encoding: 'none', content: '' });
    }
    // GitHub wraps base64 at 60 columns.
    const content = encodeBase64(text).replace(/.{60}/g, '$&\n');
    return reply(200, { name: 'backup.json', sha, encoding: 'base64', content });
  }

  private getBlob(call: FakeCall): Response {
    const text = this.blobs.get(call.path.split('/').at(-1) ?? '');
    if (text === undefined) return reply(404, { message: 'Not Found' });
    if (call.headers.accept !== 'application/vnd.github.raw+json') {
      return reply(415, { message: 'This fake only serves raw blobs' });
    }
    return reply(200, text);
  }

  private putContents(call: FakeCall): Response {
    const { content, sha } = JSON.parse(call.body ?? '{}') as { content: string; sha?: string };
    if (this.file && !sha) return reply(422, { message: `"sha" wasn't supplied.` });
    if (sha !== this.file?.sha) return reply(409, { message: 'backup.json does not match' });
    const status = this.file ? 200 : 201;
    this.commit(decodeBase64(content));
    return reply(status, { content: { sha: this.file?.sha } });
  }
}
