import type { Readable } from 'node:stream';
import type {
  MediaRecord,
  MediaStore,
  StorageDriver,
  StorageManager,
  UploadSession,
  UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
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
import {
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

/** Last path segment of a folder prefix, ignoring a trailing slash. */
function lastSegment(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
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
  ) {}

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
      folders: result.folders.map((prefix) => ({ name: lastSegment(prefix), prefix })),
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

  /** The object's raw byte stream plus the metadata the controller needs to serve it inline. Used by
   *  the console's same-origin preview proxy so text/PDF render in the browser instead of downloading
   *  (and so a CORS-locked bucket is still previewable). */
  async objectStream(
    disk: string,
    key: string,
  ): Promise<{ stream: Readable; contentType: string; size: number }> {
    const driver = this.diskOrThrow(disk);
    const stat = await driver.stat(key);
    const stream = await driver.stream(key);
    return { stream, contentType: stat.contentType ?? 'application/octet-stream', size: stat.size };
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

  async copyObject(disk: string, from: string, to: string): Promise<void> {
    await this.diskOrThrow(disk).copy(from, to);
  }

  async moveObject(disk: string, from: string, to: string): Promise<void> {
    await this.diskOrThrow(disk).move(from, to);
  }

  /** Moves a whole "folder" (every object under `<from>/`, nested included) to `<to>/`, preserving
   *  each key's path relative to the source. Same flat-listing sweep as {@link deleteFolder}. Rejects
   *  moving a folder into itself or a descendant (which would recurse forever). The destination folder
   *  marker is written and the source marker removed so both listings stay consistent. Actions-gated. */
  async moveFolder(disk: string, from: string, to: string): Promise<void> {
    const driver = this.diskOrThrow(disk);
    const fromNormalized = from.replace(/^\/+/, '').replace(/\/+$/, '');
    const toNormalized = to.replace(/^\/+/, '').replace(/\/+$/, '');
    if (fromNormalized === '') throw new BadRequestException('Source folder is required');
    if (toNormalized === '') throw new BadRequestException('Destination folder is required');
    const fromPrefix = `${fromNormalized}/`;
    const toPrefix = `${toNormalized}/`;
    if (toPrefix === fromPrefix || toPrefix.startsWith(fromPrefix)) {
      throw new BadRequestException('Cannot move a folder into itself');
    }
    let cursor: string | undefined;
    do {
      const result = await driver.list(fromPrefix, {
        delimiter: '',
        limit: DELETE_SWEEP_LIMIT,
        ...(cursor ? { cursor } : {}),
      });
      for (const entry of result.files) {
        await driver.move(entry.key, `${toPrefix}${entry.key.slice(fromPrefix.length)}`);
      }
      cursor = result.cursor;
    } while (cursor);
    // Relocate the zero-byte marker (its key equals the sweep prefix, so the sweep skips it): create
    // the destination marker, drop the source one. Idempotent if the folder had no explicit marker.
    await driver.put(toPrefix, Buffer.alloc(0));
    await driver.delete(fromPrefix);
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
