import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { type SqliteEngine, loadEngine, renderValue } from './engine.js';
import type { RangeTransport } from './range-transport.js';

/**
 * The real thing: real SQLite wasm, the real range VFS, a real database file — served through a
 * transport that reads from an ArrayBuffer instead of the network, which is the only substitution
 * made. Everything the browser cannot be asked to prove here (that sync XHR blocks, that a Worker
 * may set `responseType`) is a platform guarantee; everything that is *our* code — chunked reads,
 * short reads at EOF, the URI filename, read-only refusals, prepare/step — runs for real.
 */

/** Rows are wide enough that the file spans hundreds of pages, so partial reads are meaningful. */
const ROW_COUNT = 4000;

interface Fixture {
  bytes: Uint8Array;
  transport: RangeTransport;
  requests: () => number;
}

function buildDatabase(sqlite3: Sqlite3Static): Uint8Array {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  try {
    db.exec('CREATE TABLE widget (id INTEGER PRIMARY KEY, name TEXT, note TEXT, payload BLOB)');
    db.exec('CREATE VIEW widget_names AS SELECT id, name FROM widget');
    db.exec(`INSERT INTO widget (id, name, note, payload)
      WITH RECURSIVE seq(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${ROW_COUNT}
      )
      SELECT n, 'widget-' || n, printf('%0200d', n), CASE WHEN n = 1 THEN x'0102030405' END FROM seq`);
    db.exec('UPDATE widget SET name = NULL WHERE id = 2');
    const pDb = db.pointer;
    if (pDb === undefined) throw new Error('The fixture database has no handle.');
    return sqlite3.capi.sqlite3_js_db_export(pDb);
  } finally {
    db.close();
  }
}

function serve(bytes: Uint8Array): Fixture {
  let requests = 0;
  return {
    bytes,
    requests: () => requests,
    transport: (start, endInclusive) => {
      requests++;
      return bytes.slice(start, Math.min(endInclusive + 1, bytes.length));
    },
  };
}

describe('SqliteEngine over a range-backed file', () => {
  let engine: SqliteEngine;
  let fixture: Fixture;

  beforeAll(async () => {
    const sqlite3 = await sqlite3InitModule();
    fixture = serve(buildDatabase(sqlite3));
    engine = await loadEngine();
  });

  it('builds a fixture big enough for partial reads to matter', () => {
    expect(fixture.bytes.length).toBeGreaterThan(900_000);
  });

  it('lists tables and views without reading the whole file', () => {
    const db = engine.open({ size: fixture.bytes.length, fetchRange: fixture.transport });
    try {
      const tables = db.tables();

      expect(tables.map((table) => `${table.type}:${table.name}`)).toEqual([
        'table:widget',
        'view:widget_names',
      ]);
      expect(tables[0]?.sql).toContain('CREATE TABLE widget');
      // The whole point of the feature: a schema listing is kilobytes, not the file.
      expect(db.bytesFetched).toBeLessThan(fixture.bytes.length / 10);
    } finally {
      db.close();
    }
  });

  it('runs a limited query and reports truncation and wire cost', () => {
    const db = engine.open({ size: fixture.bytes.length, fetchRange: fixture.transport });
    try {
      const result = db.query('SELECT id, name FROM widget ORDER BY id', 200);

      expect(result.columns).toEqual(['id', 'name']);
      expect(result.rows.length).toBe(200);
      expect(result.rows[0]).toEqual(['1', 'widget-1']);
      expect(result.truncated).toBe(true);
      expect(result.bytesFetched).toBe(db.bytesFetched);
      expect(result.bytesFetched).toBeLessThan(fixture.bytes.length / 5);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      db.close();
    }
  });

  it('does not flag truncation when the result ends exactly at the limit', () => {
    const db = engine.open({ size: fixture.bytes.length, fetchRange: fixture.transport });
    try {
      const result = db.query('SELECT id FROM widget WHERE id <= 10 ORDER BY id', 10);

      expect(result.rows.length).toBe(10);
      expect(result.truncated).toBe(false);
    } finally {
      db.close();
    }
  });

  it('renders NULL as an empty string and blobs as a size', () => {
    const db = engine.open({ size: fixture.bytes.length, fetchRange: fixture.transport });
    try {
      const result = db.query(
        'SELECT name, payload FROM widget WHERE id IN (1, 2) ORDER BY id',
        10,
      );

      expect(result.rows).toEqual([
        ['widget-1', '‹5 byte blob›'],
        ['', ''],
      ]);
    } finally {
      db.close();
    }
  });

  it('reaches the far end of a large table, proving reads past the first chunks work', () => {
    const db = engine.open({ size: fixture.bytes.length, fetchRange: fixture.transport });
    try {
      const result = db.query('SELECT id, name FROM widget ORDER BY id DESC', 3);

      expect(result.rows[0]).toEqual([String(ROW_COUNT), `widget-${ROW_COUNT}`]);
      expect(fixture.requests()).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('surfaces SQLite’s own message for bad SQL', () => {
    const db = engine.open({ size: fixture.bytes.length, fetchRange: fixture.transport });
    try {
      expect(() => db.query('SELECT * FROM nope', 10)).toThrow('no such table: nope');
      expect(() => db.query('SELECT * FROM WHERE', 10)).toThrow(/syntax error/);
    } finally {
      db.close();
    }
  });

  it('refuses more than one statement instead of silently running the first', () => {
    const db = engine.open({ size: fixture.bytes.length, fetchRange: fixture.transport });
    try {
      expect(() => db.query('SELECT 1; SELECT 2', 10)).toThrow('Run one statement at a time.');
    } finally {
      db.close();
    }
  });

  it('is read-only all the way down: writes fail against the VFS, not a policy check', () => {
    const db = engine.open({ size: fixture.bytes.length, fetchRange: fixture.transport });
    const before = fixture.bytes.slice(0, 4096);
    try {
      expect(() => db.query("UPDATE widget SET name = 'hacked' WHERE id = 1", 10)).toThrow(
        /readonly|read-only/i,
      );
      expect(() => db.query('DROP TABLE widget', 10)).toThrow(/readonly|read-only/i);
      expect([...fixture.bytes.slice(0, 4096)]).toEqual([...before]);
    } finally {
      db.close();
    }
  });

  it('reports an HTTP failure through SQLite instead of losing it', () => {
    const db = engine.open({
      size: fixture.bytes.length,
      fetchRange: (start, endInclusive) => {
        // Page 1 is already cached from the header check, so let the open succeed and fail later.
        if (start === 0) return fixture.bytes.slice(start, endInclusive + 1);
        throw new Error('Range request failed with HTTP 403.');
      },
    });
    try {
      expect(() => db.query('SELECT * FROM widget ORDER BY id DESC', 10)).toThrow(/HTTP 403/);
    } finally {
      db.close();
    }
  });

  it('refuses an object that is not a SQLite database, without opening anything', () => {
    const html = new TextEncoder().encode('<!doctype html><title>Access denied</title>');
    expect(() =>
      engine.open({
        size: html.length,
        fetchRange: (start, endInclusive) => html.slice(start, endInclusive + 1),
      }),
    ).toThrow(/does not begin with a SQLite file header/);
  });

  it('propagates the transport error when even the header cannot be read', () => {
    expect(() =>
      engine.open({
        size: 1024,
        fetchRange: () => {
          throw new Error('Range request "bytes=0-1023" failed with HTTP 404.');
        },
      }),
    ).toThrow(/HTTP 404/);
  });

  it('rejects a zero-length object', () => {
    expect(() => engine.open({ size: 0, fetchRange: () => new Uint8Array() })).toThrow(
      /Cannot open an object of size 0/,
    );
  });
});

describe('renderValue', () => {
  it('renders every SQLite storage class as display text', () => {
    expect(renderValue(null)).toBe('');
    expect(renderValue(undefined)).toBe('');
    expect(renderValue('text')).toBe('text');
    expect(renderValue(42)).toBe('42');
    expect(renderValue(1.5)).toBe('1.5');
    expect(renderValue(9007199254740993n)).toBe('9007199254740993');
    expect(renderValue(Uint8Array.from([1, 2, 3]))).toBe('‹3 byte blob›');
  });
});
