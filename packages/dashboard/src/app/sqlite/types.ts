/**
 * The public shape of a SQLite session opened over HTTP byte ranges. Kept in its own module so the
 * worker can import the result types without dragging in `index.ts`, which constructs the Worker.
 */

export interface SqliteTable {
  name: string;
  type: 'table' | 'view';
  /** The CREATE statement from sqlite_master, for the schema tooltip. */
  sql: string;
}

export interface SqliteQueryResult {
  columns: string[];
  /** Values rendered for display — the preview feeds these straight into DataTable. NULL becomes ''. */
  rows: string[][];
  /** True when the row limit cut the result short. */
  truncated: boolean;
  /** Bytes actually pulled over the wire since the session opened — the console shows this, because
   *  "read 240 KB of a 302 MB database" is the whole point of this feature. */
  bytesFetched: number;
  elapsedMs: number;
}

export interface SqliteSession {
  tables(): Promise<SqliteTable[]>;
  /** Runs one read-only statement. `limit` caps the rows materialized. */
  query(sql: string, limit: number): Promise<SqliteQueryResult>;
  close(): void;
}
