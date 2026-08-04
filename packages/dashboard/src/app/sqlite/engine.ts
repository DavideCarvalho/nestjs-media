import sqlite3InitModule, { type SqlValue, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { looksLikeSqliteFile, rangeDbFile } from './db-file.js';
import { RangeReader } from './range-reader.js';
import type { RangeTransport } from './range-transport.js';
import { RANGE_VFS_NAME, type RangeVfsRegistry, installRangeVfs } from './range-vfs.js';
import type { SqliteQueryResult, SqliteTable } from './types.js';

/**
 * The engine proper: the wasm instance, the range VFS registered against it, and the open databases
 * that ride on top.
 *
 * It is deliberately free of both the Worker protocol and HTTP. Everything it needs from the network
 * arrives as a `RangeTransport` the caller supplies, which is what makes the whole path — open, VFS,
 * page reads, prepare/step — exercisable against a real SQLite file without a browser.
 */

/** Internal SQLite bookkeeping tables (`sqlite_sequence`, `sqlite_stat1`, …) are not user data. */
const TABLES_SQL = `SELECT name, type, sql FROM sqlite_schema
  WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
  ORDER BY type, name`;

/** The head of the file, read once on open to check the magic. Well under one chunk. */
const HEADER_BYTES = 16;

let loading: Promise<SqliteEngine> | null = null;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function boot(): Promise<SqliteEngine> {
  // The sqlite3 bootstrap reads this global exactly once, then deletes it. Disabling the OPFS VFSes
  // keeps init from spawning its async proxy worker and reaching for SharedArrayBuffer — which is
  // absent precisely because this feature refuses to require COOP/COEP headers from the host app.
  Object.assign(globalThis, {
    sqlite3ApiConfig: {
      disable: { vfs: { opfs: true, 'opfs-vfs': true, 'opfs-sahpool': true, 'opfs-wl': true } },
    },
  });
  const sqlite3 = await sqlite3InitModule();
  return new SqliteEngine(sqlite3, installRangeVfs(sqlite3));
}

/** Loads the wasm and installs the VFS, once per JS context. */
export function loadEngine(): Promise<SqliteEngine> {
  if (!loading) loading = boot();
  return loading;
}

export class SqliteEngine {
  readonly #sqlite3: Sqlite3Static;
  readonly #registry: RangeVfsRegistry;
  #handles = 0;

  /** Built by {@link loadEngine}; the VFS may only be installed once per wasm instance. */
  constructor(sqlite3: Sqlite3Static, registry: RangeVfsRegistry) {
    this.#sqlite3 = sqlite3;
    this.#registry = registry;
  }

  open(options: { size: number; fetchRange: RangeTransport }): OpenDatabase {
    if (!Number.isInteger(options.size) || options.size <= 0) {
      throw new Error(`Cannot open an object of size ${options.size}.`);
    }
    const { capi, wasm } = this.#sqlite3;

    // The last transport failure, kept because SQLite flattens it to "disk I/O error" on the way
    // out of the C layer and the HTTP cause would otherwise be lost.
    const transport = { lastError: null as string | null };
    const reader = new RangeReader({
      size: options.size,
      fetchRange: (start, endInclusive) => {
        try {
          return options.fetchRange(start, endInclusive);
        } catch (error) {
          transport.lastError = describe(error);
          throw error;
        }
      },
    });

    // Costs one chunk that page 1 needs anyway, and turns a wrong URL or a non-database object into
    // a plain message instead of a corruption error several reads later.
    if (!looksLikeSqliteFile(reader.read(0, HEADER_BYTES).bytes)) {
      throw new Error('This object does not begin with a SQLite file header.');
    }

    const { path, uri } = rangeDbFile(++this.#handles);
    this.#registry.register(path, reader);

    const stack = wasm.pstack.pointer;
    let pDb = 0;
    try {
      const ppDb = wasm.pstack.allocPtr();
      // SQLITE_OPEN_URI is what makes `?mode=ro&immutable=1` on the filename mean anything; the
      // wasm build does not enable URI filenames globally.
      const rc = capi.sqlite3_open_v2(
        uri,
        ppDb,
        capi.SQLITE_OPEN_READONLY | capi.SQLITE_OPEN_URI,
        RANGE_VFS_NAME,
      );
      pDb = wasm.peekPtr(ppDb);
      if (rc !== capi.SQLITE_OK) {
        const message = pDb ? capi.sqlite3_errmsg(pDb) : capi.sqlite3_errstr(rc);
        throw new Error(`Could not open the database: ${message}`);
      }
    } catch (error) {
      if (pDb) capi.sqlite3_close_v2(pDb);
      this.#registry.unregister(path);
      throw error;
    } finally {
      wasm.pstack.restore(stack);
    }

    return new OpenDatabase(this.#sqlite3, pDb, reader, transport, () =>
      this.#registry.unregister(path),
    );
  }
}

export class OpenDatabase {
  readonly #sqlite3: Sqlite3Static;
  readonly #pDb: number;
  readonly #reader: RangeReader;
  readonly #transport: { lastError: string | null };
  readonly #release: () => void;
  #closed = false;

  constructor(
    sqlite3: Sqlite3Static,
    pDb: number,
    reader: RangeReader,
    transport: { lastError: string | null },
    release: () => void,
  ) {
    this.#sqlite3 = sqlite3;
    this.#pDb = pDb;
    this.#reader = reader;
    this.#transport = transport;
    this.#release = release;
  }

  /** Bytes pulled over the wire since this database was opened. */
  get bytesFetched(): number {
    return this.#reader.bytesFetched;
  }

  tables(): SqliteTable[] {
    // No cap: a schema listing is bounded by the schema, and truncating it would hide tables.
    const result = this.query(TABLES_SQL, Number.MAX_SAFE_INTEGER);
    return result.rows.flatMap((row) => {
      const [name, type, sql] = row;
      if (name === undefined || (type !== 'table' && type !== 'view')) return [];
      return [{ name, type, sql: sql ?? '' }];
    });
  }

  /**
   * Prepares and steps one statement, materializing at most `limit` rows.
   *
   * The limit is applied by stopping the step loop, not by rewriting the SQL: the user's own
   * `LIMIT`/`ORDER BY` stay untouched, and a query over a huge table stops pulling pages the moment
   * it has enough rows — which is what keeps `SELECT * FROM big_table` cheap over the wire.
   */
  query(sql: string, limit: number): SqliteQueryResult {
    if (this.#closed) throw new Error('This database has been closed.');
    const { capi, wasm } = this.#sqlite3;
    const startedAt = performance.now();

    // The SQL is allocated rather than passed as a JS string because only the pointer form of
    // sqlite3_prepare_v2() reports where it stopped parsing — which is how the check below notices
    // a second statement instead of silently running only the first.
    const [pSql, sqlByteLength] = wasm.allocCString(sql, true);
    const stack = wasm.pstack.pointer;
    let pStmt = 0;
    try {
      const pointers = wasm.pstack.allocPtr(2);
      const ppStmt = pointers[0];
      const pzTail = pointers[1];
      if (ppStmt === undefined || pzTail === undefined) {
        throw new Error('Out of pseudo-stack space preparing the statement.');
      }

      const rc = capi.sqlite3_prepare_v2(this.#pDb, pSql, sqlByteLength, ppStmt, pzTail);
      if (rc !== capi.SQLITE_OK) throw this.#error();
      pStmt = wasm.peekPtr(ppStmt);
      if (!pStmt) throw new Error('That is not a statement.');

      const tail = wasm.cstrToJs(wasm.peekPtr(pzTail));
      if (tail !== null && tail.trim() !== '') throw new Error('Run one statement at a time.');

      const columnCount = capi.sqlite3_column_count(pStmt);
      const columns: string[] = [];
      for (let i = 0; i < columnCount; i++) columns.push(capi.sqlite3_column_name(pStmt, i));

      const rows: string[][] = [];
      while (rows.length < limit) {
        const step = capi.sqlite3_step(pStmt);
        if (step === capi.SQLITE_DONE) break;
        if (step !== capi.SQLITE_ROW) throw this.#error();
        const row: string[] = [];
        for (let i = 0; i < columnCount; i++) {
          row.push(renderValue(capi.sqlite3_column_js(pStmt, i)));
        }
        rows.push(row);
      }
      // One step past the limit distinguishes "exactly `limit` rows" from "cut short".
      const truncated = rows.length >= limit && capi.sqlite3_step(pStmt) === capi.SQLITE_ROW;

      return {
        columns,
        rows,
        truncated,
        bytesFetched: this.#reader.bytesFetched,
        elapsedMs: performance.now() - startedAt,
      };
    } finally {
      if (pStmt) capi.sqlite3_finalize(pStmt);
      wasm.pstack.restore(stack);
      wasm.dealloc(pSql);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#sqlite3.capi.sqlite3_close_v2(this.#pDb);
    this.#release();
  }

  /** The error for a failed SQLite call, preferring the HTTP cause when the VFS recorded one. */
  #error(): Error {
    const message = this.#sqlite3.capi.sqlite3_errmsg(this.#pDb);
    const cause = this.#transport.lastError;
    this.#transport.lastError = null;
    return new Error(cause ? `${message} — ${cause}` : message);
  }
}

/** Renders one column value the way DataTable wants it: plain strings, NULL as ''. */
export function renderValue(value: SqlValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return `‹${value.byteLength} byte blob›`;
}
