import { ListQueryError } from './list-api.js';

/**
 * The console's `disks/:disk/objects` cursor: an opaque Aviary cursor wrapping the driver's own
 * page token (an S3 continuation token, the core's folded-listing cursor), bound to the disk and
 * folder it pages. A cursor this console did not hand out — garbage, a raw driver token, one from
 * another disk or folder — fails decoding, so it is a 400 before any driver sees it.
 */
interface DiskCursor {
  /** Disk name. */
  d: string;
  /** Folder prefix (normalized: `''` or ends with `/`). */
  p: string;
  /** The driver's page token. */
  t: string;
}

export const MALFORMED_DISK_CURSOR = 'Malformed cursor in "after".';

export function encodeDiskCursor(disk: string, prefix: string, token: string): string {
  const cursor: DiskCursor = { d: disk, p: prefix, t: token };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** The driver token inside `cursor`; a {@link ListQueryError} (400) unless this disk + folder issued it. */
export function decodeDiskCursor(cursor: string, disk: string, prefix: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ListQueryError(MALFORMED_DISK_CURSOR);
  }
  const { d, p, t } = (parsed ?? {}) as Partial<DiskCursor>;
  if (
    typeof d !== 'string' ||
    typeof p !== 'string' ||
    typeof t !== 'string' ||
    t === '' ||
    // Canonical form only, so the cursor is exactly one this console encoded.
    encodeDiskCursor(d, p, t) !== cursor
  ) {
    throw new ListQueryError(MALFORMED_DISK_CURSOR);
  }
  if (d !== disk || p !== prefix) {
    throw new ListQueryError(`${MALFORMED_DISK_CURSOR} It pages another disk or folder.`);
  }
  return t;
}

/**
 * Whether `error`, thrown by a listing that was handed a cursor, is the driver rejecting that
 * cursor: S3's `InvalidArgument` (a continuation token it never issued), or a disk's own
 * `list(): \`cursor\` ...` `TypeError`. A well-formed console cursor wrapping a forged token
 * lands here; it is a 400, not a 500.
 */
export function isRejectedDriverCursor(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  if ((error as { code?: unknown }).code === 'InvalidArgument') return true;
  return error instanceof TypeError && /cursor/i.test(error.message);
}
