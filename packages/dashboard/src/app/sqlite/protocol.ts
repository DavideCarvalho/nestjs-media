import type { SqliteQueryResult, SqliteTable } from './types.js';

/**
 * The message contract between `openSqlite()` on the main thread and the engine in the worker.
 *
 * Both sides validate what they receive. `postMessage` is an untyped channel — `event.data` is
 * `any` no matter how carefully the sender was typed — so the guards below are the only thing that
 * actually holds the shape, and they are what let the rest of the module stay free of casts.
 */

export type SqliteRequest =
  | { id: number; type: 'open'; url: string; size: number }
  | { id: number; type: 'tables' }
  | { id: number; type: 'query'; sql: string; limit: number };

export type SqliteOkResponse =
  | { id: number; ok: true; type: 'open' }
  | { id: number; ok: true; type: 'tables'; tables: SqliteTable[] }
  | { id: number; ok: true; type: 'query'; result: SqliteQueryResult };

export type SqliteResponse = SqliteOkResponse | { id: number; ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasId(value: Record<string, unknown>): boolean {
  return typeof value.id === 'number';
}

export function isSqliteRequest(value: unknown): value is SqliteRequest {
  if (!isRecord(value) || !hasId(value)) return false;
  switch (value.type) {
    case 'open':
      return typeof value.url === 'string' && typeof value.size === 'number';
    case 'tables':
      return true;
    case 'query':
      return typeof value.sql === 'string' && typeof value.limit === 'number';
    default:
      return false;
  }
}

export function isSqliteResponse(value: unknown): value is SqliteResponse {
  if (!isRecord(value) || !hasId(value)) return false;
  if (value.ok === false) return typeof value.message === 'string';
  if (value.ok !== true) return false;
  switch (value.type) {
    case 'open':
      return true;
    case 'tables':
      return Array.isArray(value.tables);
    case 'query':
      return isRecord(value.result);
    default:
      return false;
  }
}
