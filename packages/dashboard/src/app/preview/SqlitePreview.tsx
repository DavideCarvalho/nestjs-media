import { useEffect, useState } from 'react';
import { mediaConsoleClient } from '../../client/media-console-client.js';
import { DataTable } from '../DataTable.js';
// Type-only: erased at compile time, so the SQLite engine stays out of this chunk. The implementation
// arrives through a dynamic import, and only once a database has proven to be one.
import type { SqliteQueryResult, SqliteSession, SqliteTable } from '../sqlite/index.js';
import { Alert, Button, Notice, formatBytes } from '../ui.js';
import { Textarea } from '../ui/textarea.js';
import { FallbackCard, readErrorMessage } from './shared.js';
import type { PreviewItem } from './types.js';

/** The 16 bytes every SQLite database starts with — the format's magic string, trailing NUL and all. */
const SQLITE_MAGIC = 'SQLite format 3\u0000';

/** Rows materialized per query. Enough that a table preview looks like the table; low enough that
 *  `SELECT *` over a million-row table stays a handful of range reads instead of a download. */
const SQLITE_ROW_LIMIT = 500;

/** The statement a table gets when it is clicked in the sidebar. Names come from `sqlite_master`
 *  rather than from a person, but they can still be reserved words or contain spaces, so they are
 *  quoted the SQLite way — double quotes, with an embedded quote doubled. */
function selectAllFrom(table: string): string {
  return `SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT ${SQLITE_ROW_LIMIT}`;
}

/**
 * Opens a SQLite database *where it lies* — the file is never downloaded. A worker-hosted SQLite
 * reads it through HTTP range requests over the same-origin proxy, so listing the tables and paging a
 * few hundred rows out of a 300 MB database costs a few hundred KB of transfer rather than 300 MB.
 *
 * Two things happen before the engine is touched. The object's first 16 bytes are fetched and matched
 * against SQLite's magic string: that confirms this really is a database (`.db` is claimed by half the
 * world) and, more to the point, proves the disk actually serves ranges — a disk that answers 200 to a
 * range request would otherwise be discovered halfway through streaming a 300 MB "page". Only once
 * that holds is the engine dynamically imported, so nobody who never opens a database pays for it.
 */
export function SqlitePreview({ item }: { item: PreviewItem }): JSX.Element {
  const [session, setSession] = useState<SqliteSession | null>(null);
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  const [tables, setTables] = useState<SqliteTable[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [statement, setStatement] = useState('');
  const [result, setResult] = useState<SqliteQueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run(target: SqliteSession, sql: string): Promise<void> {
    setRunning(true);
    setQueryError(null);
    try {
      setResult(await target.query(sql, SQLITE_ROW_LIMIT));
    } catch (error) {
      // SQLite's own message ("no such column: foo") is the useful thing to show someone who just
      // typed a query; don't bury it under a generic failure.
      setResult(null);
      setQueryError(readErrorMessage(error, 'Query failed.'));
    } finally {
      setRunning(false);
    }
  }

  // `run` is recreated every render but is only ever called here with the session this effect just
  // opened, so listing it would re-open the database on every keystroke in the SQL box. Keying on the
  // object instead is what keeps this to one worker per previewed database.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above — `run` is deliberately omitted
  useEffect(() => {
    let disposed = false;
    let opened: SqliteSession | null = null;

    async function boot(): Promise<void> {
      try {
        const header = await mediaConsoleClient.objectRange(item.disk, item.key, 0, 15);
        if (new TextDecoder().decode(header) !== SQLITE_MAGIC) {
          if (!disposed) setOpenFailure('This file is not a SQLite database.');
          return;
        }
        const { openSqlite } = await import('../sqlite/index.js');
        opened = await openSqlite({
          url: mediaConsoleClient.objectRawUrl(item.disk, item.key),
          size: item.size,
        });
        const listed = await opened.tables();
        if (disposed) {
          opened.close();
          return;
        }
        setSession(opened);
        setTables(listed);
        const first = listed[0];
        if (first) {
          setActiveTable(first.name);
          const sql = selectAllFrom(first.name);
          setStatement(sql);
          await run(opened, sql);
        }
      } catch (error) {
        if (!disposed) setOpenFailure(readErrorMessage(error, 'Could not open this database.'));
      }
    }

    void boot();
    return () => {
      disposed = true;
      opened?.close();
    };
  }, [item.disk, item.key, item.size]);

  if (openFailure) return <FallbackCard item={item} message={openFailure} />;
  if (!session) return <Notice>Opening database…</Notice>;

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="flex w-44 shrink-0 flex-col gap-1 overflow-auto">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">Tables</div>
        {tables.length === 0 && <Alert>No tables in this database.</Alert>}
        {tables.map((table) => (
          <Button
            key={table.name}
            tone={table.name === activeTable ? 'selected' : 'quiet'}
            title={table.sql}
            className="justify-start px-2 py-0.5 text-left"
            onClick={() => {
              setActiveTable(table.name);
              const sql = selectAllFrom(table.name);
              setStatement(sql);
              void run(session, sql);
            }}
          >
            <span className="truncate">{table.name}</span>
          </Button>
        ))}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <form
          className="flex shrink-0 items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(session, statement);
          }}
        >
          <Textarea
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            spellCheck={false}
            rows={2}
            // Enter alone would submit a one-line form, but SQL is often multi-line — so newlines stay
            // newlines and ⌘/Ctrl+Enter is the run chord, the convention every SQL console uses.
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void run(session, statement);
              }
            }}
            className="min-h-0 flex-1"
            placeholder="SELECT * FROM …"
          />
          <Button type="submit" tone="accent" disabled={running}>
            {running ? 'Running…' : 'Run'}
          </Button>
        </form>
        {queryError && <Alert variant="error">{queryError}</Alert>}
        {result && (
          <>
            <DataTable header={result.columns} body={result.rows} />
            <div className="mono tnum shrink-0 text-[10px] text-zinc-600">
              {result.rows.length} row{result.rows.length === 1 ? '' : 's'}
              {result.truncated && ` (first ${SQLITE_ROW_LIMIT})`} · read{' '}
              {formatBytes(result.bytesFetched)} of {formatBytes(item.size)} · {result.elapsedMs} ms
            </div>
          </>
        )}
      </div>
    </div>
  );
}
