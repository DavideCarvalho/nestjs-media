import type { Readable } from 'node:stream';
import {
  type MediaRecord,
  type MediaStore,
  type MediaTenantMatch,
  type MultipartDrivers,
  type UploadSession,
  type UploadSessionStore,
  assertMediaKey,
  canPresign,
  diskCapabilities,
  folderPrefix,
  hasPublicUrl,
  listFolderLevel,
  multipartFor,
} from '@dudousxd/nestjs-media-core';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type StreamableFile,
} from '@nestjs/common';
import {
  type ServeFileOptions,
  Storage,
  type StorageDisk,
  StorageError,
  StorageFileNotFoundError,
  serveFile,
} from '@nestjs/storage';
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
import type { ObjectUrlConfig } from './object-urls.js';
import { objectProxyUrl } from './object-urls.js';
import {
  MEDIA_CONSOLE_OBJECT_INSIGHTS,
  MEDIA_CONSOLE_OBJECT_URLS,
  MEDIA_DASHBOARD_ACTIONS,
  MEDIA_MULTIPART,
  MEDIA_STORE,
  MEDIA_TENANCY,
  MEDIA_UPLOAD_SESSIONS,
} from './tokens.js';

/**
 * The request's tenant scope `MediaModule` provides under `MEDIA_TENANCY` (structural: the console
 * doesn't import `@dudousxd/nestjs-media`). Absent, as with an older `MediaModule`, nothing is scoped.
 */
export interface ConsoleTenancyScope {
  match(): Promise<MediaTenantMatch | undefined>;
  canSee(tenantId: string | null | undefined): Promise<boolean>;
  /** Display labels keyed by tenant id. Absent on an older `MediaModule`: ids are shown. */
  labels?(tenantIds: string[]): Promise<Record<string, string>>;
  /**
   * The disk key prefixes this request may browse (`tenancy.pathPrefix`): `undefined` for every key,
   * `['t/<tenantId>/']` for a tenant, `[]` for nothing. Absent on an older `MediaModule`: every key.
   */
  diskPrefixes?(): Promise<string[] | undefined>;
}

/** Seconds a signed object URL stays valid. */
const URL_TTL_SECONDS = 300;
const DEFAULT_PAGE_LIMIT = 50;
/** Page size when sweeping a folder's objects for a recursive delete/copy/move. */
const SWEEP_LIMIT = 1000;
/**
 * The zero-byte file `createFolder` writes so an empty folder exists: `@nestjs/storage` refuses keys
 * ending in `/`, so the S3-style `prefix/` marker can't be written. Hidden from listings.
 */
export const FOLDER_KEEP_FILE = '.keep';

/** `MediaListFilter.nameContains`: `name` or `fileName` contains `text`, ignoring case. */
function matchesName(record: MediaRecord, text: string): boolean {
  const needle = text.toLowerCase();
  return (
    record.name.toLowerCase().includes(needle) || record.fileName.toLowerCase().includes(needle)
  );
}

/** Last path segment of a folder prefix, ignoring a trailing slash. */
function lastSegment(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/** A folder path from the client (`a/b`, `a/b/`, `/a/b`) as `a/b/`; 400 when it can't be a key. */
function clientFolder(prefix: string, what: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, '');
  let normalized: string;
  try {
    normalized = folderPrefix(trimmed);
  } catch (error) {
    throw new BadRequestException(`${what}: ${(error as Error).message}`);
  }
  if (normalized === '') throw new BadRequestException(`${what} is required`);
  return normalized;
}

/** Whether `key` is one `@nestjs/storage` can address (a legacy `prefix/` marker isn't). */
function isAddressable(key: string): boolean {
  try {
    assertMediaKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Whether a search prefix stays where it says: it follows the key rule (no `..`, `\\`, `//`). */
function isPlainPrefix(prefix: string): boolean {
  return isAddressable(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix);
}

/** Core errors that carry a client `status` (400). */
const CORE_CLIENT_ERRORS = new Set(['InvalidMediaKeyError', 'InvalidListingCursorError']);

/**
 * Storage errors as HTTP: `@nestjs/storage`'s errors carry a `status` (404 missing file, 400
 * invalid key, 409 key conflict, 416 range) that Nest's exception filter doesn't read on its own;
 * so do the core's `InvalidMediaKeyError` and `InvalidListingCursorError` (400).
 * An object store failure (`StorageServiceError`, no status) stays a 500.
 */
function toHttp(error: unknown): unknown {
  if (error instanceof HttpException) return error;
  if (error instanceof StorageFileNotFoundError) return new NotFoundException(error.message);
  const status = (error as { status?: unknown } | null)?.status;
  if (
    (error instanceof StorageError ||
      CORE_CLIENT_ERRORS.has((error as Error | null)?.name ?? '')) &&
    typeof status === 'number'
  ) {
    return new HttpException((error as Error).message, status);
  }
  return error;
}

async function http<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toHttp(error);
  }
}

/** Labels for the tenants of `rows`, keyed by id; `undefined` when tenancy is off. */
type Labels = Record<string, string> | undefined;

/** A row's tenant for the console: absent with tenancy off, `null` with no tenant. */
function tenantOf(
  tenantId: string | null | undefined,
  labels: Labels,
): Pick<LibraryRecord, 'tenant'> {
  if (labels === undefined) return {};
  if (tenantId === null || tenantId === undefined) return { tenant: null };
  return { tenant: { id: tenantId, label: labels[tenantId] ?? tenantId } };
}

function mapUpload(session: UploadSession, labels?: Labels): UploadInfo {
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
    ...tenantOf(session.tenantId, labels),
  };
}

function mapRecord(record: MediaRecord, labels?: Labels): LibraryRecord {
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
    ...tenantOf(record.tenantId, labels),
  };
}

/**
 * Read + action logic behind the console's JSON API, on the disks of `@nestjs/storage` (`Storage`).
 * Resolves the store, upload store and multipart side-cars with `@Optional()` so a host without
 * them still boots — every method degrades to an empty shape instead of throwing.
 */
@Injectable()
export class MediaConsoleService {
  constructor(
    @Optional() @Inject(Storage) private readonly storage: Storage | null,
    @Optional() @Inject(MEDIA_STORE) private readonly store: MediaStore | null,
    @Optional() @Inject(MEDIA_UPLOAD_SESSIONS) private readonly uploads: UploadSessionStore | null,
    @Optional() @Inject(MEDIA_DASHBOARD_ACTIONS) private readonly actionsEnabled: boolean | null,
    // Defaulted, not merely `@Optional()`: the console service is constructed directly in unit
    // tests (and by any host wiring it by hand).
    @Optional()
    @Inject(MEDIA_CONSOLE_OBJECT_INSIGHTS)
    private readonly insightProviders: ObjectInsightProvider[] | null = null,
    // Strategy and mount path travel as ONE value. `null` means `auto`.
    @Optional()
    @Inject(MEDIA_CONSOLE_OBJECT_URLS)
    private readonly objectUrls: ObjectUrlConfig | null = null,
    /** `MediaModuleOptions.multipart`: native folder listing and the multipart badge. */
    @Optional()
    @Inject(MEDIA_MULTIPART)
    private readonly multipart: MultipartDrivers | null = null,
    /** `MediaModuleOptions.tenancy`: library records and upload sessions follow the request's tenant. */
    @Optional()
    @Inject(MEDIA_TENANCY)
    private readonly tenancy: ConsoleTenancyScope | null = null,
  ) {}

  /** The store filter for this request (`undefined`: every row). */
  private async tenantMatch(): Promise<MediaTenantMatch | undefined> {
    return this.tenancy ? this.tenancy.match() : undefined;
  }

  /**
   * Labels for the tenants of `rows` (tenancy on), else `undefined`. A labeler failure falls back to
   * the ids: a label never breaks a listing.
   */
  private async labelsFor(rows: Array<{ tenantId?: string | null }>): Promise<Labels> {
    if (!this.tenancy || !rows.some((row) => row.tenantId !== undefined)) return undefined;
    const ids = rows.flatMap((row) => (typeof row.tenantId === 'string' ? [row.tenantId] : []));
    if (ids.length === 0 || typeof this.tenancy.labels !== 'function') return {};
    return this.tenancy.labels(ids).catch(() => ({}));
  }

  /**
   * The disk key prefixes this request may touch (`tenancy.pathPrefix`); `undefined` for every key.
   */
  private async diskPrefixes(): Promise<string[] | undefined> {
    return typeof this.tenancy?.diskPrefixes === 'function'
      ? this.tenancy.diskPrefixes()
      : undefined;
  }

  /**
   * A confined viewer reaches only keys inside their prefixes; anything else, or a key that could
   * resolve elsewhere (`..`, a leading `/`, a backslash), is reported as not found (404).
   */
  private async confine(disk: string, ...keys: string[]): Promise<void> {
    const prefixes = await this.diskPrefixes();
    if (prefixes === undefined) return;
    for (const key of keys) {
      if (!isAddressable(key) || !prefixes.some((prefix) => key.startsWith(prefix))) {
        throw new NotFoundException(`Unknown object: ${disk}:${key}`);
      }
    }
  }

  /** {@link confine} for a folder (`a/b/`, checked as the folder itself). */
  private async confineFolder(disk: string, ...folders: string[]): Promise<void> {
    const prefixes = await this.diskPrefixes();
    if (prefixes === undefined) return;
    for (const folder of folders) {
      if (!prefixes.some((prefix) => folder.startsWith(prefix))) {
        throw new NotFoundException(`Unknown folder: ${disk}:${folder}`);
      }
    }
  }

  /** Whether this request may see a row of `tenantId`; a hidden row is reported as not found. */
  private async canSee(tenantId: string | null | undefined): Promise<boolean> {
    return this.tenancy ? this.tenancy.canSee(tenantId) : true;
  }

  private readonly logger = new Logger(MediaConsoleService.name);

  /**
   * The URL to report for an object's bytes, under the host's {@link ObjectUrlStrategy}. `auto`
   * prefers the disk's public URL, then a signed one (S3 presigns; a local disk signs with
   * `signedUrls`), and falls back to this server's own route for a disk that can do neither.
   * `proxy` always routes through this server.
   */
  private async objectUrl(disk: StorageDisk, name: string, key: string): Promise<string> {
    const proxy = () => objectProxyUrl(this.objectUrls?.apiBasePath ?? '', 'raw', name, key);
    if (this.objectUrls?.strategy === 'proxy') return proxy();
    if (hasPublicUrl(disk)) return disk.url(key);
    if (await canPresign(disk)) return disk.signedUrl(key, { expiresIn: URL_TTL_SECONDS * 1000 });
    return proxy();
  }

  private diskOrThrow(disk: string): StorageDisk {
    if (!this.storage || !this.storage.names().includes(disk)) {
      throw new NotFoundException(`Unknown disk: ${disk}`);
    }
    return this.storage.disk(disk);
  }

  async listDisks(): Promise<DiskListResponse> {
    const storage = this.storage;
    if (!storage) return { disks: [] };
    return {
      disks: await Promise.all(
        storage.names().map(async (name) => ({
          name,
          default: name === storage.defaultDisk,
          capabilities: await diskCapabilities(
            storage.disk(name),
            multipartFor(this.multipart ?? undefined, name),
          ),
        })),
      ),
    };
  }

  /**
   * One folder level. `StorageDisk.list()` is flat; a disk whose multipart side-car lists with a
   * delimiter (S3) asks the store for folders, any other disk folds its flat listing.
   */
  async listObjects(
    disk: string,
    options: { prefix?: string; cursor?: string; limit?: number },
  ): Promise<ObjectListResponse> {
    const store = this.diskOrThrow(disk);
    const raw = (options.prefix ?? '').replace(/^\/+/, '');
    let prefix: string;
    try {
      prefix = folderPrefix(raw);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const prefixes = await this.diskPrefixes();
    if (prefixes !== undefined && !prefixes.some((p) => prefix.startsWith(p))) {
      // Above the viewer's prefixes (the root, `t/`): just the folders leading to them.
      const below = prefixes.filter((p) => p.startsWith(prefix));
      if (below.length === 0 && prefix !== '') {
        throw new NotFoundException(`Unknown folder: ${disk}:${prefix}`);
      }
      const folders = [
        ...new Set(below.map((p) => `${prefix}${p.slice(prefix.length).split('/')[0]}/`)),
      ];
      return {
        folders: folders.map((folder) => ({ name: lastSegment(folder), prefix: folder })),
        files: [],
      };
    }
    const level = await http(() =>
      listFolderLevel(
        store,
        prefix,
        {
          limit: options.limit ?? DEFAULT_PAGE_LIMIT,
          ...(options.cursor ? { cursor: options.cursor } : {}),
        },
        multipartFor(this.multipart ?? undefined, disk),
      ),
    );
    return {
      folders: level.folders
        .map((folder) => ({ name: lastSegment(folder), prefix: folder }))
        .filter((folder) => folder.name !== ''),
      files: level.files
        .map((entry) => ({ entry, name: entry.key.slice(prefix.length) }))
        .filter(({ name }) => name !== '' && name !== FOLDER_KEEP_FILE)
        .map(({ entry, name }) => ({
          key: entry.key,
          name,
          sizeBytes: entry.size,
          lastModified: entry.lastModified.toISOString(),
        })),
      ...(level.cursor ? { cursor: level.cursor } : {}),
    };
  }

  async objectDetail(disk: string, key: string): Promise<ObjectDetailResponse> {
    const store = this.diskOrThrow(disk);
    await this.confine(disk, key);
    return http(async () => {
      const stat = await store.stat(key);
      return {
        key,
        size: stat.size,
        contentType: stat.contentType,
        lastModified: stat.lastModified.toISOString(),
        url: await this.objectUrl(store, disk, key),
      };
    });
  }

  /**
   * What the HOST knows about this object, from every registered provider. Its own call rather
   * than a field on `objectDetail`, so host lookups stay off the preview path. A provider that
   * throws is logged and dropped; providers run concurrently.
   */
  async objectInsights(disk: string, key: string): Promise<ObjectInsightsResponse> {
    const providers = this.insightProviders ?? [];
    if (providers.length === 0) {
      return { insights: [] };
    }
    this.diskOrThrow(disk);
    await this.confine(disk, key);

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
   * Streams an object as the response through `@nestjs/storage`'s `serveFile()`: a single `Range`
   * gets a 206 with `Content-Range` (how a SQLite/ZIP/Parquet preview reads a few KB out of a huge
   * object), `If-None-Match` a 304, a range past the end a 416, a missing file a 404. `inline`
   * applies only to types that can't run script in this origin; others download.
   */
  async serveObject(
    disk: string,
    key: string,
    options: ServeFileOptions,
  ): Promise<StreamableFile | undefined> {
    const store = this.diskOrThrow(disk);
    await this.confine(disk, key);
    return http(() => serveFile(store, key, options));
  }

  /**
   * Writes an object from a byte stream (a browser upload), streamed onto the disk: S3Disk turns a
   * body of unknown length into a multipart upload itself, so nothing is buffered here. With the
   * request's `Content-Length`, a body that ends short fails and nothing is written.
   */
  async putObject(
    disk: string,
    key: string,
    body: Readable,
    contentType?: string,
    contentLength?: number,
  ): Promise<void> {
    const store = this.diskOrThrow(disk);
    await this.confine(disk, key);
    await http(() =>
      store.put(key, body, {
        ...(contentType ? { contentType } : {}),
        ...(contentLength !== undefined ? { contentLength } : {}),
      }),
    );
  }

  /**
   * Creates a folder: a zero-byte `<prefix>/.keep` file (hidden from listings), since
   * `@nestjs/storage` keys can't end with `/`. Listings show the folder because a key lives in it.
   */
  async createFolder(disk: string, prefix: string): Promise<void> {
    const store = this.diskOrThrow(disk);
    const folder = clientFolder(prefix, 'Folder name');
    await this.confineFolder(disk, folder);
    await http(() => store.put(`${folder}${FOLDER_KEEP_FILE}`, ''));
  }

  async deleteObject(disk: string, key: string): Promise<void> {
    const store = this.diskOrThrow(disk);
    await this.confine(disk, key);
    await http(() => store.delete(key));
  }

  /**
   * Recursively deletes a folder: every file under `<prefix>/`, nested included (its `.keep`
   * too), a batch of keys per `delete()`. A legacy `prefix/` marker object written by another tool
   * can't be addressed through `@nestjs/storage`; it is skipped.
   */
  async deleteFolder(disk: string, prefix: string): Promise<void> {
    const store = this.diskOrThrow(disk);
    const folder = clientFolder(prefix, 'Folder');
    await this.confineFolder(disk, folder);
    await http(async () => {
      const keys: string[] = [];
      for await (const entry of store.listAll({ prefix: folder, limit: SWEEP_LIMIT })) {
        if (isAddressable(entry.key)) keys.push(entry.key);
      }
      for (let start = 0; start < keys.length; start += SWEEP_LIMIT) {
        await store.delete(keys.slice(start, start + SWEEP_LIMIT));
      }
    });
  }

  async copyObject(fromDisk: string, from: string, toDisk: string, to: string): Promise<void> {
    await this.confine(fromDisk, from);
    await this.confine(toDisk, to);
    await http(() => this.transferKey('copy', fromDisk, from, toDisk, to));
  }

  async moveObject(fromDisk: string, from: string, toDisk: string, to: string): Promise<void> {
    await this.confine(fromDisk, from);
    await this.confine(toDisk, to);
    await http(() => this.transferKey('move', fromDisk, from, toDisk, to));
  }

  /**
   * Copies or moves one object. Same disk: the disk's own `copy`/`move` (server-side on S3, a
   * rename on a local disk). Across disks: the source's body streams into the destination's
   * `put()` (no size limit, nothing buffered), keeping its content type, cache control,
   * disposition and metadata; a `move` then deletes the source.
   */
  private async transferKey(
    op: 'copy' | 'move',
    fromDisk: string,
    from: string,
    toDisk: string,
    to: string,
  ): Promise<void> {
    const source = this.diskOrThrow(fromDisk);
    if (fromDisk === toDisk) {
      if (op === 'move') await source.move(from, to);
      else await source.copy(from, to);
      return;
    }
    const target = this.diskOrThrow(toDisk);
    const download = await source.get(from);
    try {
      await target.put(to, download.body, {
        contentType: download.contentType,
        contentLength: download.size,
        ...(download.cacheControl ? { cacheControl: download.cacheControl } : {}),
        ...(download.contentDisposition ? { contentDisposition: download.contentDisposition } : {}),
        metadata: download.metadata,
      });
    } finally {
      download.body.destroy();
    }
    if (op === 'move') await source.delete(from);
  }

  /** Moves a whole folder (every file under `<from>/`, nested included) to `<to>/`. */
  async moveFolder(fromDisk: string, from: string, toDisk: string, to: string): Promise<void> {
    await http(() => this.transferFolder('move', fromDisk, from, toDisk, to));
  }

  /** Copies a whole folder (every file under `<from>/`, nested included) to `<to>/`. */
  async copyFolder(fromDisk: string, from: string, toDisk: string, to: string): Promise<void> {
    await http(() => this.transferFolder('copy', fromDisk, from, toDisk, to));
  }

  /**
   * Shared engine for {@link moveFolder}/{@link copyFolder}: a flat sweep of the source, each key
   * relocated via {@link transferKey}, keeping its path relative to the folder (an empty folder's
   * `.keep` goes along). On the SAME disk, a destination inside the source is refused (it would
   * recurse forever).
   */
  private async transferFolder(
    op: 'copy' | 'move',
    fromDisk: string,
    from: string,
    toDisk: string,
    to: string,
  ): Promise<void> {
    const source = this.diskOrThrow(fromDisk);
    this.diskOrThrow(toDisk);
    const fromPrefix = clientFolder(from, 'Source folder');
    const toPrefix = clientFolder(to, 'Destination folder');
    await this.confineFolder(fromDisk, fromPrefix);
    await this.confineFolder(toDisk, toPrefix);
    if (fromDisk === toDisk && toPrefix.startsWith(fromPrefix)) {
      throw new BadRequestException(`Cannot ${op} a folder into itself`);
    }
    // The keys first, then the transfers: a move changes the listing it would be paging through.
    const keys: string[] = [];
    for await (const entry of source.listAll({ prefix: fromPrefix, limit: SWEEP_LIMIT })) {
      if (isAddressable(entry.key)) keys.push(entry.key);
    }
    for (const key of keys) {
      await this.transferKey(
        op,
        fromDisk,
        key,
        toDisk,
        `${toPrefix}${key.slice(fromPrefix.length)}`,
      );
    }
  }

  async listUploads(filter: { disk?: string; prefix?: string }): Promise<UploadListResponse> {
    if (!this.uploads || typeof this.uploads.list !== 'function') return { uploads: [] };
    const tenant = await this.tenantMatch();
    const sessions = await this.uploads.list({
      ...(filter.disk ? { disk: filter.disk } : {}),
      ...(filter.prefix ? { keyPrefix: filter.prefix } : {}),
      ...(tenant ? { tenant } : {}),
    });
    const labels = await this.labelsFor(sessions);
    return { uploads: sessions.map((session) => mapUpload(session, labels)) };
  }

  async uploadDetail(id: string): Promise<UploadDetailResponse> {
    if (!this.uploads) throw new NotFoundException('No upload store configured');
    const session = await this.uploads.get(id);
    if (!session || !(await this.canSee(session.tenantId))) {
      throw new NotFoundException(`Unknown upload: ${id}`);
    }
    const parts = this.uploads.listParts ? await this.uploads.listParts(id) : [];
    return { upload: mapUpload(session, await this.labelsFor([session])), parts };
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
    if (this.tenancy) {
      // Missing and hidden answer alike (404), so another tenant's ids can't be probed.
      const session = await this.uploads.get(id);
      if (!session || !(await this.canSee(session.tenantId))) {
        throw new NotFoundException(`Unknown upload: ${id}`);
      }
    }
    await this.uploads.delete(id);
  }

  async listCollections(): Promise<CollectionsResponse> {
    if (!this.store || typeof this.store.aggregate !== 'function') return { collections: [] };
    const tenant = await this.tenantMatch();
    const buckets = await this.store.aggregate({
      groupBy: 'collection',
      sum: 'size',
      ...(tenant ? { tenant } : {}),
    });
    return { collections: buckets };
  }

  async listLibrary(filter: {
    collection?: string;
    disk?: string;
    cursor?: string;
    limit?: number;
  }): Promise<LibraryListResponse> {
    if (!this.store || typeof this.store.list !== 'function') return { records: [] };
    const tenant = await this.tenantMatch();
    const page = await this.store.list(
      {
        ...(filter.collection ? { collection: filter.collection } : {}),
        ...(filter.disk ? { disk: filter.disk } : {}),
        ...(tenant ? { tenant } : {}),
      },
      {
        limit: filter.limit ?? DEFAULT_PAGE_LIMIT,
        ...(filter.cursor ? { cursor: filter.cursor } : {}),
      },
    );
    const labels = await this.labelsFor(page.records);
    return {
      records: page.records.map((record) => mapRecord(record, labels)),
      ...(page.cursor ? { cursor: page.cursor } : {}),
    };
  }

  async libraryDetail(id: string): Promise<LibraryDetailResponse> {
    if (!this.store) throw new NotFoundException('No media store configured');
    const record = await this.store.find(id);
    if (!record || !(await this.canSee(record.tenantId))) {
      throw new NotFoundException(`Unknown media record: ${id}`);
    }
    const variants = await Promise.all(
      Object.entries(record.conversions).map(async ([name, conversion]) => {
        const disk = this.storage?.names().includes(conversion.disk)
          ? this.storage.disk(conversion.disk)
          : null;
        const url = disk
          ? await this.objectUrl(disk, conversion.disk, conversion.path).catch(() => '')
          : '';
        // `disk`/`path` ride along so the UI can reach the object routes (download, and a proxied
        // read) for a variant — `url` alone is opaque, and under `auto` points off this origin.
        return { name, url, disk: conversion.disk, path: conversion.path };
      }),
    );
    return { record: mapRecord(record, await this.labelsFor([record])), variants };
  }

  async deleteLibraryRecord(id: string): Promise<void> {
    if (!this.store) throw new NotFoundException('No media store configured');
    if (this.tenancy) {
      // Missing and hidden answer alike (404), so another tenant's ids can't be probed.
      const record = await this.store.find(id);
      if (!record || !(await this.canSee(record.tenantId))) {
        throw new NotFoundException(`Unknown media record: ${id}`);
      }
    }
    await this.store.delete(id);
  }

  /**
   * Global search (the console switcher's): files whose name matches `q`, scoped like every other
   * read. A library record by its exact id, library records whose name or file name contains `q`
   * (both by the request's tenant), and disk objects whose key starts with `q`: every disk object
   * when no tenant scope applies, with `tenancy.pathPrefix` only those under the viewer's own
   * `t/<tenantId>/`. At most `limit` hits, linking into the console at `page` (`#/library/<id>`,
   * `#/disks/<disk>?prefix=<folder>&preview=<key>`). A source that fails is skipped.
   */
  async search(
    q: string,
    limit: number,
    page: string,
  ): Promise<Array<{ title: string; subtitle?: string; href: string }>> {
    const quiet = <T>(read: () => Promise<T>, fallback: T): Promise<T> =>
      Promise.resolve()
        .then(read)
        .catch(() => fallback);
    let tenant: MediaTenantMatch | undefined;
    let prefixes: string[] | undefined;
    try {
      tenant = await this.tenantMatch();
      prefixes = await this.diskPrefixes();
    } catch (error) {
      // No tenant where one is required (the context's `TenantRequiredError`, 403): nothing this
      // viewer may see. Anything else (a store that can't scope by tenant) fails the search.
      if ((error as { code?: unknown } | null)?.code === 'E_TENANT_REQUIRED') return [];
      throw error;
    }
    const store = this.store;
    const [byId, named, files] = await Promise.all([
      quiet(async () => {
        const record = store ? await store.find(q) : null;
        return record && (await this.canSee(record.tenantId)) ? record : null;
      }, null),
      quiet(async () => {
        if (!store || typeof store.list !== 'function') return [];
        const found = await store.list(
          { nameContains: q, ...(tenant ? { tenant } : {}) },
          { limit },
        );
        // A store that predates `nameContains` ignores it: keep only real matches.
        return found.records.filter((record) => matchesName(record, q));
      }, [] as MediaRecord[]),
      // Disk objects carry no tenant: searched when the request sees every tenant's rows, or, with
      // `tenancy.pathPrefix`, under this tenant's own `t/<tenantId>/`.
      quiet(async () => {
        const key = q.replace(/^\/+/, '');
        if (prefixes === undefined)
          return tenant === undefined ? this.filesByKey(key, limit, page) : [];
        const perPrefix = await Promise.all(
          prefixes.map((prefix) => {
            const scoped = key.startsWith(prefix) ? key : `${prefix}${key}`;
            return isPlainPrefix(scoped) ? this.filesByKey(scoped, limit, page, prefix) : [];
          }),
        );
        return perPrefix.flat();
      }, []),
    ]);
    const records = [...(byId ? [byId] : []), ...named];
    const labels = await this.labelsFor(records).catch(() => undefined);
    const recordHit = (record: MediaRecord) => {
      const owner = typeof record.tenantId === 'string' ? labels?.[record.tenantId] : undefined;
      return {
        title: record.name !== '' ? record.name : record.fileName,
        subtitle: ['Library', record.collection, record.fileName, ...(owner ? [owner] : [])].join(
          ' · ',
        ),
        href: `${page}#/library/${encodeURIComponent(record.id)}`,
      };
    };
    const hits = [...records.map(recordHit), ...files];
    const seen = new Set<string>();
    return hits
      .filter((hit) => {
        if (seen.has(hit.href)) return false;
        seen.add(hit.href);
        return true;
      })
      .slice(0, limit);
  }

  /** Objects on every disk whose key starts with `prefix` (and `within`), as search hits. */
  private async filesByKey(
    prefix: string,
    limit: number,
    page: string,
    within = '',
  ): Promise<Array<{ title: string; subtitle: string; href: string }>> {
    const storage = this.storage;
    if (!storage || prefix === '') return [];
    const perDisk = await Promise.all(
      storage.names().map(async (name) => {
        const listed = await storage
          .disk(name)
          .list({ prefix, limit: limit + 1 })
          .catch(() => ({ entries: [] }));
        return listed.entries
          .filter(
            (entry) => entry.key.startsWith(within) && lastSegment(entry.key) !== FOLDER_KEEP_FILE,
          )
          .map((entry) => {
            const slash = entry.key.lastIndexOf('/');
            const params = new URLSearchParams();
            if (slash !== -1) params.set('prefix', entry.key.slice(0, slash + 1));
            params.set('preview', entry.key);
            return {
              title: entry.key.slice(slash + 1),
              subtitle: `${name} · ${entry.key}`,
              href: `${page}#/disks/${encodeURIComponent(name)}?${params.toString()}`,
            };
          });
      }),
    );
    return perDisk.flat().slice(0, limit);
  }

  topology(): Topology {
    return {
      hasStore: this.store !== null && typeof this.store.list === 'function',
      hasUploads: this.uploads !== null && typeof this.uploads.list === 'function',
      disks: this.storage ? this.storage.names().length : 0,
      actions: this.actionsEnabled === true,
    };
  }
}
