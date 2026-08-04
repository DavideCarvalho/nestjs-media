import { describe, expect, it } from 'vitest';
import { looksLikeSqliteFile, rangeDbFile } from './db-file.js';
import { isSqliteRequest, isSqliteResponse } from './protocol.js';

describe('rangeDbFile', () => {
  it('opens read-only and immutable, so SQLite never probes for -wal or -journal', () => {
    expect(rangeDbFile(1).uri).toBe('file:/range/1.sqlite3?mode=ro&immutable=1');
  });

  it('keeps the path clear of the characters SQLite splits a URI filename on', () => {
    for (const handle of [0, 1, 42, 1_000_000]) {
      const { path } = rangeDbFile(handle);
      expect(path).not.toMatch(/[?#]/);
      expect(path.startsWith('/')).toBe(true);
    }
  });

  it('gives each handle its own path', () => {
    expect(rangeDbFile(1).path).not.toBe(rangeDbFile(2).path);
  });
});

describe('looksLikeSqliteFile', () => {
  const header = new TextEncoder().encode('SQLite format 3\u0000');

  it('accepts the SQLite file header', () => {
    expect(looksLikeSqliteFile(header)).toBe(true);
  });

  it('rejects an HTML error page served with a 206', () => {
    expect(looksLikeSqliteFile(new TextEncoder().encode('<!doctype html><title>Forb'))).toBe(false);
  });

  it('rejects a truncated header rather than guessing', () => {
    expect(looksLikeSqliteFile(header.subarray(0, 8))).toBe(false);
  });

  it('rejects a header whose trailing NUL is missing', () => {
    expect(looksLikeSqliteFile(new TextEncoder().encode('SQLite format 3X'))).toBe(false);
  });
});

describe('protocol guards', () => {
  it('accepts the three request shapes', () => {
    expect(isSqliteRequest({ id: 1, type: 'open', url: '/db', size: 10 })).toBe(true);
    expect(isSqliteRequest({ id: 2, type: 'tables' })).toBe(true);
    expect(isSqliteRequest({ id: 3, type: 'query', sql: 'select 1', limit: 200 })).toBe(true);
  });

  it('rejects anything else that arrives on the message port', () => {
    expect(isSqliteRequest(null)).toBe(false);
    expect(isSqliteRequest('tables')).toBe(false);
    expect(isSqliteRequest({ type: 'tables' })).toBe(false);
    expect(isSqliteRequest({ id: 1, type: 'query', sql: 'select 1' })).toBe(false);
    expect(isSqliteRequest({ id: 1, type: 'drop' })).toBe(false);
  });

  it('accepts both arms of a response', () => {
    expect(isSqliteResponse({ id: 1, ok: true, type: 'tables', tables: [] })).toBe(true);
    expect(isSqliteResponse({ id: 1, ok: false, message: 'no such table: t' })).toBe(true);
  });

  it('rejects a response missing its payload', () => {
    expect(isSqliteResponse({ id: 1, ok: true, type: 'tables' })).toBe(false);
    expect(isSqliteResponse({ id: 1, ok: false })).toBe(false);
    expect(isSqliteResponse({ id: 1 })).toBe(false);
  });
});
