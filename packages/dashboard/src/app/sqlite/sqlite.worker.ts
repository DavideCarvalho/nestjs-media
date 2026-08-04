import { type OpenDatabase, loadEngine } from './engine.js';
import {
  type SqliteOkResponse,
  type SqliteRequest,
  type SqliteResponse,
  isSqliteRequest,
} from './protocol.js';
import { createSyncRangeTransport } from './range-transport.js';

/**
 * The worker side of the session: a message adapter over `engine.ts`, and the only place a
 * synchronous XHR transport is wired in.
 *
 * The engine runs here for one reason: SQLite's `xRead` must block, and only a Worker may issue the
 * synchronous request that makes blocking possible (see range-transport.ts).
 *
 * One worker holds exactly one database. `openSqlite()` spawns a worker per session and terminates
 * it on close, which makes teardown a single `terminate()` — no wasm heap to unwind, no VFS to
 * unregister, nothing left over between previews.
 */

let database: OpenDatabase | null = null;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireOpen(): OpenDatabase {
  if (!database) throw new Error('No database is open in this session.');
  return database;
}

async function execute(request: SqliteRequest): Promise<SqliteOkResponse> {
  switch (request.type) {
    case 'open': {
      if (database) throw new Error('This session already has a database open.');
      const engine = await loadEngine();
      database = engine.open({
        size: request.size,
        fetchRange: createSyncRangeTransport(request.url),
      });
      return { id: request.id, ok: true, type: 'open' };
    }
    case 'tables':
      return { id: request.id, ok: true, type: 'tables', tables: requireOpen().tables() };
    case 'query':
      return {
        id: request.id,
        ok: true,
        type: 'query',
        result: requireOpen().query(request.sql, request.limit),
      };
  }
}

function reply(response: SqliteResponse): void {
  postMessage(response);
}

// The app tsconfig ships the DOM lib rather than WebWorker, so the worker talks through the two
// globals both libs describe identically. `event.data` crosses postMessage untyped, hence the guard.
addEventListener('message', (event) => {
  const request: unknown = event.data;
  if (!isSqliteRequest(request)) return;
  void (async () => {
    try {
      reply(await execute(request));
    } catch (error) {
      reply({ id: request.id, ok: false, message: describe(error) });
    }
  })();
});
