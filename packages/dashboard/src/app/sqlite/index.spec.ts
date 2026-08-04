import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSqlite } from './index.js';
import { type SqliteRequest, type SqliteResponse, isSqliteRequest } from './protocol.js';

/**
 * The main-thread half of a session: request correlation, error propagation, teardown. The engine
 * itself is covered against real wasm in engine.spec.ts; here the Worker is stubbed, because what is
 * under test is the wiring on this side of the message port and nothing else.
 */

type Listener = (event: { data?: unknown; message?: string }) => void;

class FakeWorker {
  static last: FakeWorker | null = null;
  /** Answers each request as it is posted. Set per test. */
  static respond: ((request: SqliteRequest, worker: FakeWorker) => void) | null = null;

  readonly requests: SqliteRequest[] = [];
  terminated = false;
  readonly #listeners = new Map<string, Listener[]>();

  constructor() {
    FakeWorker.last = this;
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.#listeners.get(type) ?? [];
    existing.push(listener);
    this.#listeners.set(type, existing);
  }

  postMessage(message: unknown): void {
    if (!isSqliteRequest(message)) throw new Error('The session posted a malformed request.');
    this.requests.push(message);
    FakeWorker.respond?.(message, this);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(response: SqliteResponse): void {
    this.emit('message', { data: response });
  }

  /** Anything that is not a valid response — a stray message from some other library, say. */
  noise(data: unknown): void {
    this.emit('message', { data });
  }

  crash(message: string): void {
    this.emit('error', { message });
  }

  emit(type: string, event: { data?: unknown; message?: string }): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

/** Acknowledges `open` and leaves everything else for the test to answer. */
function acknowledgeOpen(request: SqliteRequest, worker: FakeWorker): void {
  if (request.type === 'open') worker.reply({ id: request.id, ok: true, type: 'open' });
}

function lastWorker(): FakeWorker {
  const worker = FakeWorker.last;
  if (!worker) throw new Error('No worker was constructed.');
  return worker;
}

describe('openSqlite', () => {
  beforeEach(() => {
    FakeWorker.last = null;
    FakeWorker.respond = acknowledgeOpen;
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.respond = null;
  });

  it('opens by handing the worker the url and the size the caller already knows', async () => {
    const session = await openSqlite({ url: '/media/api/objects/db.sqlite3', size: 316_669_952 });

    expect(lastWorker().requests[0]).toMatchObject({
      type: 'open',
      url: '/media/api/objects/db.sqlite3',
      size: 316_669_952,
    });
    expect(session).toBeDefined();
  });

  it('rejects and disposes of the worker when the open fails', async () => {
    FakeWorker.respond = (request, worker) => {
      worker.reply({ id: request.id, ok: false, message: 'HTTP 403 on the first range request.' });
    };

    await expect(openSqlite({ url: '/db', size: 10 })).rejects.toThrow('HTTP 403');
    expect(lastWorker().terminated).toBe(true);
  });

  it('correlates concurrent requests by id, whatever order they come back in', async () => {
    const session = await openSqlite({ url: '/db', size: 10 });
    const worker = lastWorker();
    FakeWorker.respond = null;

    const first = session.query('SELECT 1', 5);
    const second = session.query('SELECT 2', 5);
    const [a, b] = worker.requests.slice(1);
    if (!a || !b) throw new Error('Expected two queries to have been posted.');

    // Answered back to front on purpose.
    worker.reply({
      id: b.id,
      ok: true,
      type: 'query',
      result: { columns: ['b'], rows: [['2']], truncated: false, bytesFetched: 2, elapsedMs: 1 },
    });
    worker.reply({
      id: a.id,
      ok: true,
      type: 'query',
      result: { columns: ['a'], rows: [['1']], truncated: false, bytesFetched: 1, elapsedMs: 1 },
    });

    expect((await first).columns).toEqual(['a']);
    expect((await second).columns).toEqual(['b']);
  });

  it('passes the sql and the row limit through, and returns what came back', async () => {
    const session = await openSqlite({ url: '/db', size: 10 });
    const worker = lastWorker();
    FakeWorker.respond = (request, target) => {
      if (request.type !== 'query') return;
      target.reply({
        id: request.id,
        ok: true,
        type: 'query',
        result: {
          columns: ['id'],
          rows: [['1']],
          truncated: true,
          bytesFetched: 245_760,
          elapsedMs: 12,
        },
      });
    };

    const result = await session.query('SELECT id FROM widget', 200);

    expect(worker.requests[1]).toMatchObject({ sql: 'SELECT id FROM widget', limit: 200 });
    expect(result.truncated).toBe(true);
    expect(result.bytesFetched).toBe(245_760);
  });

  it('surfaces a worker-side error as a rejection carrying its message', async () => {
    const session = await openSqlite({ url: '/db', size: 10 });
    FakeWorker.respond = (request, worker) => {
      worker.reply({ id: request.id, ok: false, message: 'no such table: nope' });
    };

    await expect(session.query('SELECT * FROM nope', 5)).rejects.toThrow('no such table: nope');
  });

  it('catches a worker answering the wrong kind of request', async () => {
    const session = await openSqlite({ url: '/db', size: 10 });
    FakeWorker.respond = (request, worker) => {
      if (request.type === 'tables') worker.reply({ id: request.id, ok: true, type: 'open' });
    };

    await expect(session.tables()).rejects.toThrow(/answered a "tables" request with "open"/);
  });

  it('ignores messages that are not responses at all', async () => {
    const session = await openSqlite({ url: '/db', size: 10 });
    const worker = lastWorker();
    FakeWorker.respond = null;

    const pending = session.tables();
    worker.noise('hello');
    worker.noise({ id: 'not-a-number', ok: true, type: 'tables', tables: [] });
    const request = worker.requests[1];
    if (!request) throw new Error('Expected a tables request.');
    worker.reply({ id: request.id, ok: true, type: 'tables', tables: [] });

    await expect(pending).resolves.toEqual([]);
  });

  it('terminates on close and fails everything still in flight', async () => {
    const session = await openSqlite({ url: '/db', size: 10 });
    const worker = lastWorker();
    FakeWorker.respond = null;

    const pending = session.query('SELECT 1', 5);
    session.close();

    expect(worker.terminated).toBe(true);
    await expect(pending).rejects.toThrow('This SQLite session was closed.');
    await expect(session.tables()).rejects.toThrow('This SQLite session was closed.');
  });

  it('fails every later call once the worker itself has crashed', async () => {
    const session = await openSqlite({ url: '/db', size: 10 });
    const worker = lastWorker();
    FakeWorker.respond = null;

    const pending = session.tables();
    worker.crash('Worker script failed to load.');

    await expect(pending).rejects.toThrow('Worker script failed to load.');
    await expect(session.query('SELECT 1', 5)).rejects.toThrow('Worker script failed to load.');
  });
});
