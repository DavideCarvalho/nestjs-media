import { type SqliteOkResponse, type SqliteRequest, isSqliteResponse } from './protocol.js';
import type { SqliteQueryResult, SqliteSession, SqliteTable } from './types.js';

export type { SqliteQueryResult, SqliteSession, SqliteTable } from './types.js';

/** A request as callers write it; the id is the transport's business, not theirs. Distributive, so
 *  each member of the union keeps its own fields. */
type Unsent<T> = T extends { id: number } ? Omit<T, 'id'> : never;

interface Waiter {
  resolve: (response: SqliteOkResponse) => void;
  reject: (error: Error) => void;
}

/**
 * Opens a SQLite database that lives in object storage, over HTTP byte ranges, without downloading
 * it. Listing the tables of a 302 MB database costs a few hundred KB; a `SELECT … LIMIT 200` costs
 * the pages that query actually touches.
 *
 * `url` must be same-origin and must honor `Range` with a `206` + `Content-Range`; `size` is the
 * object's total byte size, which the caller already knows.
 *
 * Nothing here belongs at the top level of the console bundle — reach this module through
 * `await import('./sqlite/index.js')`, which is what keeps the wasm off the critical path of every
 * page that is not previewing a database.
 */
export function openSqlite(options: { url: string; size: number }): Promise<SqliteSession> {
  // Vite compiles this exact form into a separate worker chunk and rewrites the URL; the wasm the
  // worker pulls in becomes its own emitted asset rather than part of any JS chunk.
  const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });

  const pending = new Map<number, Waiter>();
  let nextId = 1;
  let failure: Error | null = null;

  /** Fails every outstanding call and every later one — a terminated or crashed worker never recovers. */
  function fail(error: Error): void {
    failure ??= error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  }

  worker.addEventListener('message', (event) => {
    const response: unknown = event.data;
    if (!isSqliteResponse(response)) return;
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.ok) waiter.resolve(response);
    else waiter.reject(new Error(response.message));
  });

  worker.addEventListener('error', (event) => {
    fail(new Error(event.message || 'The SQLite worker failed to start.'));
  });

  function send(request: Unsent<SqliteRequest>): Promise<SqliteOkResponse> {
    if (failure) return Promise.reject(failure);
    const id = nextId++;
    return new Promise<SqliteOkResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id });
    });
  }

  function mismatch(expected: string, got: string): Error {
    return new Error(`The SQLite worker answered a "${expected}" request with "${got}".`);
  }

  const session: SqliteSession = {
    async tables(): Promise<SqliteTable[]> {
      const response = await send({ type: 'tables' });
      if (response.type !== 'tables') throw mismatch('tables', response.type);
      return response.tables;
    },
    async query(sql: string, limit: number): Promise<SqliteQueryResult> {
      const response = await send({ type: 'query', sql, limit });
      if (response.type !== 'query') throw mismatch('query', response.type);
      return response.result;
    },
    close(): void {
      // Terminating drops the wasm heap, the VFS and the chunk cache in one move — there is nothing
      // a graceful shutdown would release that this does not.
      fail(new Error('This SQLite session was closed.'));
      worker.terminate();
    },
  };

  return send({ type: 'open', url: options.url, size: options.size })
    .then(() => session)
    .catch((error: unknown) => {
      worker.terminate();
      throw error instanceof Error ? error : new Error(String(error));
    });
}
