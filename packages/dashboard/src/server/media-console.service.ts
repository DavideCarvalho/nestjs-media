import type { Readable } from 'node:stream';
import type {
  MediaRecord,
  MediaStore,
  ReadRangeOptions,
  StorageDriver,
  StorageManager,
  UploadSession,
  UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  Optional,
  PayloadTooLargeException,
} from '@nestjs/common';
import type {
  CollectionsResponse,
  DiskListResponse,
  LibraryDetailResponse,
  LibraryListResponse,
  LibraryRecord,
  ObjectDetailResponse,
  ObjectListResponse,
  Topology,
  UploadDetailResponse,
  UploadInfo,
  UploadListResponse,
} from '../client/types.js';
import type {
  ObjectInsight,
  ObjectInsightProvider,
  ObjectInsightsResponse,
} from './object-insights.js';
import { sanitizeInsight } from './object-insights.js';
import {
  MEDIA_CONSOLE_OBJECT_INSIGHTS,
  MEDIA_DASHBOARD_ACTIONS,
  MEDIA_STORAGE_SHARED,
  MEDIA_STORE,
  MEDIA_UPLOAD_SESSIONS,
} from './tokens.js';

/** Seconds a generated preview/download URL stays valid. */
const URL_TTL_SECONDS = 300;
const DEFAULT_PAGE_LIMIT = 50;
/** Ceiling for a console (direct) upload — buffered in memory, so bounded to protect the heap. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** Page size when sweeping a folder's objects for a recursive delete. */
const DELETE_SWEEP_LIMIT = 1000;
/** Ceiling for a cross-disk copy/move. The driver has no server-side cross-bucket copy, so the object
 *  is streamed through the pod (get→put, buffered) — bounded to protect the heap. Same-disk transfers
 *  use the driver's native copy/move and are not subject to this cap. */
const MAX_CROSS_DISK_BYTES = 100 * 1024 * 1024;

/** Last path segment of a folder prefix, ignoring a trailing slash. */
function lastSegment(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/**
 * A range as the CLIENT asked for it, before the object's size is known.
 *
 * Either an absolute {@link ReadRangeOptions}, or HTTP's suffix form (`Range: bytes=-500`, "the last
 * 500 bytes") — which cannot be made absolute without the size, and the size is `stat`'s to give.
 * Resolving it here rather than in the controller saves a second `stat` on the request path.
 */
export type RequestedReadRange = ReadRangeOptions | { suffixLength: number };

/**
 * The requested range cannot be satisfied against this object (start at/past EOF, or start > end).
 *
 * A dedicated class rather than a bare `HttpException` because RFC 9110 requires a 416 to carry an
 * unsatisfied-range `Content-Range` naming the object's real size, so the client learns the size and
 * can retry — and only the controller can set a header. This carries the size across that boundary.
 */
export class RangeNotSatisfiableException extends HttpException {
  constructor(readonly size: number) {
    super(
      {
        statusCode: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
        message: `Requested range is not satisfiable for an object of ${size} bytes`,
        error: 'Range Not Satisfiable',
      },
      HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
    );
  }
}

/** What {@link MediaConsoleService.objectStream} hands the controller. `range` is present only when
 *  a range was requested AND satisfied, already absolute and clamped to the object — so the
 *  controller can write `Content-Range`/`Content-Length` without re-deriving anything. */
export interface ObjectStreamResult {
  stream: Readable;
  contentType: string;
  /** Total size of the OBJECT, not of the slice — the `/<size>` in `Content-Range`. */
  size: number;
  /** Absolute inclusive bounds actually being streamed. Absent on a full-body read. */
  range?: { start: number; end: number };
}

/**
 * Resolve a requested range into absolute, inclusive, in-bounds bounds — or `null` when it is
 * unsatisfiable and the answer has to be a 416.
 *
 * Unsatisfiable means a start at or past EOF (there is no such byte) or a start past the end; a
 * zero-byte object consequently rejects every range, which is what RFC 9110 prescribes. An `end`
 * beyond EOF is NOT unsatisfiable — it is clamped, because "the next 64 KB from offset N" is how
 * every paging reader asks for the tail of a file, and erroring there would make the last page of
 * every object unreadable.
 */
function resolveRange(
  range: RequestedReadRange,
  size: number,
): { start: number; end: number } | null {
  if ('suffixLength' in range) {
    // `bytes=-N`: the last N bytes. A suffix longer than the object is the whole object; `bytes=-0`
    // asks for nothing, which RFC 9110 defines as unsatisfiable rather than as an empty 206.
    if (!Number.isInteger(range.suffixLength) || range.suffixLength <= 0 || size === 0) return null;
    return { start: Math.max(0, size - range.suffixLength), end: size - 1 };
  }
  const { start } = range;
  if (!Number.isInteger(start) || start < 0 || start >= size) return null;
  const end = range.end === undefined ? size - 1 : Math.min(range.end, size - 1);
  if (!Number.isInteger(end) || end < start) return null;
  return { start, end };
}

function mapUpload(session: UploadSession): UploadInfo {
  const percent =
    session.size !== undefined && session.size > 0
      ? Math.min(100, Math.round((session.offset / session.size) * 100))
      : null;
  return {
    id: session.id,
    disk: session.disk,
    key: session.key,
    offset: session.offset,
    size: session.size ?? null,
    percent,
    parts: session.parts,
    multipart: session.multipartUploadId !== undefined,
    ...(session.createdAt ? { createdAt: session.createdAt.toISOString() } : {}),
  };
}

function mapRecord(record: MediaRecord): LibraryRecord {
  return {
    id: record.id,
    ownerType: record.ownerType,
    ownerId: record.ownerId,
    collection: record.collection,
    name: record.name,
    fileName: record.fileName,
    mimeType: record.mimeType,
    size: record.size,
    disk: record.disk,
    path: record.path,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Read + action logic behind the console's JSON API. Resolves the three by-value media tokens
 * with `@Optional()` so a host without a `MediaStore`/upload store still boots — every method
 * degrades to an empty shape instead of throwing when its capability is absent.
 */
@Injectable()
export class MediaConsoleService {
  constructor(
    @Optional() @Inject(MEDIA_STORAGE_SHARED) private readonly storage: StorageManager | null,
    @Optional() @Inject(MEDIA_STORE) private readonly store: MediaStore | null,
    @Optional() @Inject(MEDIA_UPLOAD_SESSIONS) private readonly uploads: UploadSessionStore | null,
    @Optional() @Inject(MEDIA_DASHBOARD_ACTIONS) private readonly actionsEnabled: boolean | null,
    // Defaulted, not merely `@Optional()`: the console service is constructed directly in unit
    // tests (and by any host wiring it by hand), so a required 5th argument would break every one
    // of those call sites for a feature they do not use.
    @Optional()
    @Inject(MEDIA_CONSOLE_OBJECT_INSIGHTS)
    private readonly insightProviders: ObjectInsightProvider[] | null = null,
  ) {}

  private readonly logger = new Logger(MediaConsoleService.name);

  private diskOrThrow(disk: string): StorageDriver {
    if (!this.storage || !this.storage.diskNames().includes(disk)) {
      throw new NotFoundException(`Unknown disk: ${disk}`);
    }
    return this.storage.disk(disk);
  }

  listDisks(): DiskListResponse {
    const storage = this.storage;
    if (!storage) return { disks: [] };
    const defaultDisk = storage.defaultDisk;
    return {
      disks: storage.diskNames().map((name) => ({
        name,
        default: name === defaultDisk,
        capabilities: storage.disk(name).capabilities,
      })),
    };
  }

  async listObjects(
    disk: string,
    options: { prefix?: string; cursor?: string; limit?: number },
  ): Promise<ObjectListResponse> {
    const driver = this.diskOrThrow(disk);
    const result = await driver.list(options.prefix ?? '', {
      delimiter: '/',
      ...(options.cursor ? { cursor: options.cursor } : {}),
      limit: options.limit ?? DEFAULT_PAGE_LIMIT,
    });
    return {
      // Drop phantom folders whose name is empty — a CommonPrefix of only slashes (`/`, `//`),
      // produced by a stray key with a leading slash. The S3 driver normalizes such a prefix back to
      // the root, so listing INTO one returns the root again (the phantom included) — a self-reference
      // that infinite-loops the folder tree. Filtering it out removes the trap; those leading-slash
      // keys are unreachable from the console anyway (the driver strips the leading slash).
      folders: result.folders
        .map((prefix) => ({ name: lastSegment(prefix), prefix }))
        .filter((folder) => folder.name !== ''),
      // Drop the zero-byte "folder marker" (a key ending in `/`, whose name is empty after the
      // prefix) that `createFolder` writes — it's the folder itself, not a file inside it.
      files: result.files
        .filter((entry) => entry.name !== '')
        .map((entry) => ({
          key: entry.key,
          name: entry.name,
          sizeBytes: entry.sizeBytes,
          lastModified: entry.lastModified ? entry.lastModified.toISOString() : null,
        })),
      ...(result.cursor ? { cursor: result.cursor } : {}),
    };
  }

  async objectDetail(disk: string, key: string): Promise<ObjectDetailResponse> {
    const driver = this.diskOrThrow(disk);
    const stat = await driver.stat(key);
    const url = driver.capabilities.presign
      ? await driver.temporaryUrl(key, URL_TTL_SECONDS)
      : await driver.url(key);
    return {
      key,
      size: stat.size,
      ...(stat.contentType ? { contentType: stat.contentType } : {}),
      ...(stat.lastModified ? { lastModified: stat.lastModified.toISOString() } : {}),
      url,
    };
  }

  /**
   * What the HOST knows about this object, from every registered provider.
   *
   * Its own call rather than a field on `objectDetail`, for the same reason the RAG index-status
   * endpoint is separate from its document listing: `objectDetail` is on the path of every preview
   * and every navigation, and providers reach into host databases. Folding them in would put a host
   * query on reads that only wanted a presigned URL.
   *
   * Failures are contained per provider. A provider that throws is logged and dropped, and the
   * others still render — annotation must never be able to stop an admin opening a file, and one
   * host lookup being down says nothing about the rest.
   *
   * Providers run concurrently: they are independent host lookups, and running them in series would
   * make the panel as slow as their sum for no gain.
   */
  async objectInsights(disk: string, key: string): Promise<ObjectInsightsResponse> {
    const providers = this.insightProviders ?? [];
    if (providers.length === 0) {
      return { insights: [] };
    }
    // Validates the disk the same way every other object read does, so an unknown disk 404s here
    // too rather than silently handing host providers a key from nowhere.
    this.diskOrThrow(disk);

    const settled = await Promise.all(
      providers.map(async (provider): Promise<ObjectInsight | null> => {
        try {
          return await provider.resolve({ disk, key });
        } catch (error) {
          this.logger.warn(
            `Object-insight provider "${provider.id}" failed for ${disk}:${key} — ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return null;
        }
      }),
    );

    return {
      insights: settled
        .filter((insight): insight is ObjectInsight => insight !== null)
        .map(sanitizeInsight),
    };
  }

  /**
   * The object's raw byte stream plus the metadata the controller needs to serve it inline. Used by
   * the console's same-origin preview proxy so text/PDF render in the browser instead of downloading
   * (and so a CORS-locked bucket is still previewable).
   *
   * With `range`, only that slice — which is what makes previewing a multi-hundred-MB object (a
   * SQLite database read a page at a time) possible at all. The range is resolved HERE, not in the
   * driver, because it has to be checked against the object's size and the `stat` for that is
   * already on this path: the suffix form is made absolute, an overrunning `end` is clamped to the
   * last byte, and anything genuinely unsatisfiable becomes a {@link RangeNotSatisfiableException}
   * (HTTP 416) instead of a surprise empty body.
   *
   * A driver that reports `ranged: false` REFUSES a range request rather than quietly returning the
   * whole object: the caller asked for 64 KB out of 400 MB, and silently answering with all 400 MB
   * — which the caller would then read as if it were the slice — is the exact failure the `ranged`
   * capability exists to make impossible.
   */
  async objectStream(
    disk: string,
    key: string,
    range?: RequestedReadRange,
  ): Promise<ObjectStreamResult> {
    const driver = this.diskOrThrow(disk);
    const stat = await driver.stat(key);
    const contentType = stat.contentType ?? 'application/octet-stream';
    if (!range) {
      return { stream: await driver.stream(key), contentType, size: stat.size };
    }
    if (!driver.capabilities.ranged) {
      throw new NotImplementedException(`Disk "${disk}" cannot serve byte ranges`);
    }
    const resolved = resolveRange(range, stat.size);
    if (!resolved) throw new RangeNotSatisfiableException(stat.size);
    return {
      stream: await driver.stream(key, resolved),
      contentType,
      size: stat.size,
      range: resolved,
    };
  }

  /** Writes an object from a byte stream (a browser upload). The caller supplies the full key
   *  (prefix + filename); an unknown disk 404s via {@link diskOrThrow}. Actions-gated.
   *
   *  The request stream is buffered before the write: S3's PutObject needs a known Content-Length,
   *  which a raw request stream doesn't carry, so passing the stream straight through fails. Bounded
   *  at {@link MAX_UPLOAD_BYTES} so a runaway upload can't exhaust the pod's heap — larger files
   *  belong on the resumable upload path, not this console convenience upload. */
  async putObject(disk: string, key: string, body: Readable, contentType?: string): Promise<void> {
    const driver = this.diskOrThrow(disk);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_UPLOAD_BYTES) {
        throw new PayloadTooLargeException(
          `Upload exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB console limit.`,
        );
      }
      chunks.push(buffer);
    }
    await driver.put(key, Buffer.concat(chunks), contentType ? { contentType } : undefined);
  }

  /** Creates a "folder" — a zero-byte marker object at `<prefix>/`, which S3-style listing surfaces
   *  as a navigable folder. Normalizes to exactly one trailing slash; rejects an empty prefix. */
  async createFolder(disk: string, prefix: string): Promise<void> {
    const normalized = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
    if (normalized === '') throw new BadRequestException('Folder name is required');
    await this.diskOrThrow(disk).put(`${normalized}/`, Buffer.alloc(0));
  }

  async deleteObject(disk: string, key: string): Promise<void> {
    await this.diskOrThrow(disk).delete(key);
  }

  /** Recursively deletes a "folder": every object under `<prefix>/` (nested included) plus the
   *  zero-byte marker itself. Passes an empty delimiter so the driver lists keys FLAT — the default
   *  `/` delimiter would group nested keys into CommonPrefixes and the sweep would miss them, only
   *  deleting direct children. Paginates until the disk reports no more. The marker's own key equals
   *  the sweep prefix, which `list` filters out (Key === Prefix), so it's deleted explicitly at the
   *  end. Actions-gated. */
  async deleteFolder(disk: string, prefix: string): Promise<void> {
    const driver = this.diskOrThrow(disk);
    const normalized = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
    if (normalized === '') throw new BadRequestException('Folder is required');
    const sweepPrefix = `${normalized}/`;
    let cursor: string | undefined;
    do {
      const result = await driver.list(sweepPrefix, {
        delimiter: '',
        limit: DELETE_SWEEP_LIMIT,
        ...(cursor ? { cursor } : {}),
      });
      for (const entry of result.files) {
        await driver.delete(entry.key);
      }
      cursor = result.cursor;
    } while (cursor);
    await driver.delete(sweepPrefix);
  }

  async copyObject(fromDisk: string, from: string, toDisk: string, to: string): Promise<void> {
    await this.transferKey('copy', fromDisk, from, toDisk, to);
  }

  async moveObject(fromDisk: string, from: string, toDisk: string, to: string): Promise<void> {
    await this.transferKey('move', fromDisk, from, toDisk, to);
  }

  /** Copies or moves a single object, on the same disk or across disks. Same-disk uses the driver's
   *  native `copy`/`move` (server-side, no bytes through the pod). Cross-disk has no driver primitive,
   *  so the object is streamed through the pod (get→put, buffered), preserving its content type and
   *  bounded at {@link MAX_CROSS_DISK_BYTES}; a `move` then deletes the source. */
  private async transferKey(
    op: 'copy' | 'move',
    fromDisk: string,
    from: string,
    toDisk: string,
    to: string,
  ): Promise<void> {
    const fromDriver = this.diskOrThrow(fromDisk);
    if (fromDisk === toDisk) {
      if (op === 'move') await fromDriver.move(from, to);
      else await fromDriver.copy(from, to);
      return;
    }
    const toDriver = this.diskOrThrow(toDisk);
    const stat = await fromDriver.stat(from);
    if (stat.size > MAX_CROSS_DISK_BYTES) {
      throw new PayloadTooLargeException(
        `"${from}" is ${Math.round(stat.size / (1024 * 1024))} MB — over the ${
          MAX_CROSS_DISK_BYTES / (1024 * 1024)
        } MB limit for copying across disks from the console.`,
      );
    }
    const bytes = await fromDriver.get(from);
    await toDriver.put(to, bytes, stat.contentType ? { contentType: stat.contentType } : undefined);
    if (op === 'move') await fromDriver.delete(from);
  }

  /** Moves a whole "folder" (every object under `<from>/`, nested included) to `<to>/`, on the same
   *  disk or across disks, preserving each key's path relative to the source. */
  async moveFolder(fromDisk: string, from: string, toDisk: string, to: string): Promise<void> {
    await this.transferFolder('move', fromDisk, from, toDisk, to);
  }

  /** Copies a whole "folder" (every object under `<from>/`, nested included) to `<to>/`, same disk or
   *  across disks, preserving each key's path relative to the source. */
  async copyFolder(fromDisk: string, from: string, toDisk: string, to: string): Promise<void> {
    await this.transferFolder('copy', fromDisk, from, toDisk, to);
  }

  /** Shared engine for {@link moveFolder}/{@link copyFolder}. Same flat-listing sweep as
   *  {@link deleteFolder}; each key is relocated via {@link transferKey} (so cross-disk transfers work
   *  transparently). On the SAME disk, rejects a destination inside the source (which would recurse
   *  forever); across disks that constraint doesn't apply. The destination folder marker is written,
   *  and for a move the source marker is removed, so both listings stay consistent. Actions-gated. */
  private async transferFolder(
    op: 'copy' | 'move',
    fromDisk: string,
    from: string,
    toDisk: string,
    to: string,
  ): Promise<void> {
    const fromDriver = this.diskOrThrow(fromDisk);
    const toDriver = this.diskOrThrow(toDisk);
    const fromNormalized = from.replace(/^\/+/, '').replace(/\/+$/, '');
    const toNormalized = to.replace(/^\/+/, '').replace(/\/+$/, '');
    if (fromNormalized === '') throw new BadRequestException('Source folder is required');
    if (toNormalized === '') throw new BadRequestException('Destination folder is required');
    const fromPrefix = `${fromNormalized}/`;
    const toPrefix = `${toNormalized}/`;
    if (fromDisk === toDisk && (toPrefix === fromPrefix || toPrefix.startsWith(fromPrefix))) {
      throw new BadRequestException(`Cannot ${op} a folder into itself`);
    }
    let cursor: string | undefined;
    do {
      const result = await fromDriver.list(fromPrefix, {
        delimiter: '',
        limit: DELETE_SWEEP_LIMIT,
        ...(cursor ? { cursor } : {}),
      });
      for (const entry of result.files) {
        const destKey = `${toPrefix}${entry.key.slice(fromPrefix.length)}`;
        await this.transferKey(op, fromDisk, entry.key, toDisk, destKey);
      }
      cursor = result.cursor;
    } while (cursor);
    // Relocate/replicate the zero-byte marker (its key equals the sweep prefix, so the sweep skips it):
    // write the destination marker, and for a move drop the source one. Idempotent if there was none.
    await toDriver.put(toPrefix, Buffer.alloc(0));
    if (op === 'move') await fromDriver.delete(fromPrefix);
  }

  async listUploads(filter: { disk?: string; prefix?: string }): Promise<UploadListResponse> {
    if (!this.uploads || typeof this.uploads.list !== 'function') return { uploads: [] };
    const sessions = await this.uploads.list({
      ...(filter.disk ? { disk: filter.disk } : {}),
      ...(filter.prefix ? { keyPrefix: filter.prefix } : {}),
    });
    return { uploads: sessions.map(mapUpload) };
  }

  async uploadDetail(id: string): Promise<UploadDetailResponse> {
    if (!this.uploads) throw new NotFoundException('No upload store configured');
    const session = await this.uploads.get(id);
    if (!session) throw new NotFoundException(`Unknown upload: ${id}`);
    const parts = this.uploads.listParts ? await this.uploads.listParts(id) : [];
    return { upload: mapUpload(session), parts };
  }

  /**
   * Cancels a resumable session by removing its record from the upload store, so it stops
   * appearing as in-progress. NOTE: this does NOT tear down an underlying native multipart upload
   * (e.g. an S3 multipart) or its temporary parts — the decoupled console resolves only the
   * `UploadSessionStore`, not the `ResumableUploadManager` that owns `abort()`. An incomplete
   * multipart is reaped by the bucket's lifecycle policy. Surfaced as "Cancel session" in the UI.
   */
  async abortUpload(id: string): Promise<void> {
    if (!this.uploads) throw new NotFoundException('No upload store configured');
    await this.uploads.delete(id);
  }

  async listCollections(): Promise<CollectionsResponse> {
    if (!this.store || typeof this.store.aggregate !== 'function') return { collections: [] };
    const buckets = await this.store.aggregate({ groupBy: 'collection', sum: 'size' });
    return { collections: buckets };
  }

  async listLibrary(filter: {
    collection?: string;
    disk?: string;
    cursor?: string;
    limit?: number;
  }): Promise<LibraryListResponse> {
    if (!this.store || typeof this.store.list !== 'function') return { records: [] };
    const page = await this.store.list(
      {
        ...(filter.collection ? { collection: filter.collection } : {}),
        ...(filter.disk ? { disk: filter.disk } : {}),
      },
      {
        limit: filter.limit ?? DEFAULT_PAGE_LIMIT,
        ...(filter.cursor ? { cursor: filter.cursor } : {}),
      },
    );
    return {
      records: page.records.map(mapRecord),
      ...(page.cursor ? { cursor: page.cursor } : {}),
    };
  }

  async libraryDetail(id: string): Promise<LibraryDetailResponse> {
    if (!this.store) throw new NotFoundException('No media store configured');
    const record = await this.store.find(id);
    if (!record) throw new NotFoundException(`Unknown media record: ${id}`);
    const variants = await Promise.all(
      Object.entries(record.conversions).map(async ([name, conversion]) => {
        const driver = this.storage?.diskNames().includes(conversion.disk)
          ? this.storage.disk(conversion.disk)
          : null;
        const url = driver?.capabilities.presign
          ? await driver.temporaryUrl(conversion.path, URL_TTL_SECONDS)
          : ((await driver?.url(conversion.path)) ?? '');
        return { name, url };
      }),
    );
    return { record: mapRecord(record), variants };
  }

  async deleteLibraryRecord(id: string): Promise<void> {
    if (!this.store) throw new NotFoundException('No media store configured');
    await this.store.delete(id);
  }

  topology(): Topology {
    return {
      hasStore: this.store !== null && typeof this.store.list === 'function',
      hasUploads: this.uploads !== null && typeof this.uploads.list === 'function',
      disks: this.storage ? this.storage.diskNames().length : 0,
      actions: this.actionsEnabled === true,
    };
  }
}
