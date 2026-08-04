/**
 * How a range-backed database is named to SQLite, and the cheapest possible check that the bytes on
 * the far end really are one.
 */

/** The 16-byte magic every SQLite database file starts with, including its terminating NUL. */
const HEADER_MAGIC = 'SQLite format 3\u0000';

/**
 * Names one range-backed database and builds the URI filename SQLite opens it through.
 *
 * The path is minted from an integer handle rather than from the object's key, which keeps it free
 * of `?` and `#` by construction — SQLite splits a URI filename on those, so a key containing one
 * would silently truncate the path and turn the rest into bogus parameters.
 *
 * The two parameters carry real weight:
 * - `mode=ro` opens the file read-only even if some later code path asks for write access.
 * - `immutable=1` promises the file never changes under us, which is what stops SQLite from probing
 *   for the `-wal`, `-shm` and `-journal` sidecars. Those don't exist as separate objects, so every
 *   probe would be a wasted round-trip on open, and a rollback-journal probe could turn into a
 *   write attempt.
 */
export function rangeDbFile(handle: number): { path: string; uri: string } {
  const path = `/range/${Math.trunc(handle)}.sqlite3`;
  return { path, uri: `file:${path}?mode=ro&immutable=1` };
}

/**
 * Whether the first bytes of the object look like a SQLite database. Checked eagerly on open so a
 * wrong URL, an HTML error page served with a 206, or a non-database object fails with a plain
 * message instead of surfacing later as "file is not a database" on the user's first query.
 */
export function looksLikeSqliteFile(head: Uint8Array): boolean {
  if (head.length < HEADER_MAGIC.length) return false;
  for (let i = 0; i < HEADER_MAGIC.length; i++) {
    if (head[i] !== HEADER_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}
