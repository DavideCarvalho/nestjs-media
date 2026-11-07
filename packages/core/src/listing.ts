import type { StorageDisk } from '@nestjs/storage';
import type { FolderListing, MultipartUploadDriver } from './types';

export interface FoldListingOptions {
  /** The `cursor` of the previous page. */
  cursor?: string;
  /** Entries (folders + files) per page. Default 50. */
  limit?: number;
  /** Keys asked of the disk per `list()` call. Default 1000. */
  pageSize?: number;
  /**
   * `list()` calls one fold may make before it returns what it has (with a cursor), so a folder
   * holding millions of keys can't hold a request for minutes. Default 20.
   */
  maxPages?: number;
}

interface FoldCursor {
  /** The disk cursor of the page to resume in (absent: the first page). */
  c?: string;
  /** Entries of that page already handled. */
  o: number;
  /** The last folder returned: its remaining keys are skipped. */
  f?: string;
}

function encode(cursor: FoldCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decode(cursor: string | undefined): FoldCursor {
  if (!cursor) return { o: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as FoldCursor;
    if (typeof parsed.o === 'number' && parsed.o >= 0) return parsed;
  } catch {
    // fall through
  }
  throw new TypeError('foldListing(): `cursor` must be the cursor of a previous page');
}

/**
 * One folder level of a disk, folded from its flat listing (`StorageDisk.list()` has no
 * delimiter). `prefix` is `''` or ends with `/`. Keys come in byte order, so all the keys under a
 * folder are contiguous: a folder is returned once, and a page that ends inside one carries it in
 * the cursor so the next page skips the rest of it. A zero-byte `prefix/` marker object (written by
 * other tools; `@nestjs/storage` can't create one) is not returned as a file.
 */
export async function foldListing(
  disk: StorageDisk,
  prefix: string,
  options: FoldListingOptions = {},
): Promise<FolderListing> {
  const limit = options.limit ?? 50;
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? 20;
  const state = decode(options.cursor);
  const result: FolderListing = { folders: [], files: [] };
  let pageCursor = state.c;
  let index = state.o;
  let lastFolder = state.f;
  let count = 0;

  for (let pages = 1; ; pages += 1) {
    const page = await disk.list({
      prefix,
      limit: pageSize,
      ...(pageCursor ? { cursor: pageCursor } : {}),
    });
    for (let i = index; i < page.entries.length; i += 1) {
      const entry = page.entries[i] as (typeof page.entries)[number];
      const rest = entry.key.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        if (rest === '') continue;
        result.files.push(entry);
      } else {
        const folder = prefix + rest.slice(0, slash + 1);
        if (folder === lastFolder) continue;
        result.folders.push(folder);
        lastFolder = folder;
      }
      count += 1;
      if (count === limit) {
        const more = i + 1 < page.entries.length;
        if (more)
          result.cursor = encode({
            ...(pageCursor ? { c: pageCursor } : {}),
            o: i + 1,
            ...(lastFolder ? { f: lastFolder } : {}),
          });
        else if (page.cursor)
          result.cursor = encode({
            c: page.cursor,
            o: 0,
            ...(lastFolder ? { f: lastFolder } : {}),
          });
        return result;
      }
    }
    if (!page.cursor) return result;
    pageCursor = page.cursor;
    index = 0;
    if (pages >= maxPages) {
      result.cursor = encode({ c: pageCursor, o: 0, ...(lastFolder ? { f: lastFolder } : {}) });
      return result;
    }
  }
}

/**
 * One folder level: the side-car's native delimiter listing when it has one (S3
 * `ListObjectsV2` with `Delimiter`), else {@link foldListing}.
 */
export function listFolderLevel(
  disk: StorageDisk,
  prefix: string,
  options: { cursor?: string; limit?: number },
  multipart?: MultipartUploadDriver,
): Promise<FolderListing> {
  if (multipart?.listFolders) return multipart.listFolders(prefix, options);
  return foldListing(disk, prefix, options);
}
