import type {
  MediaRecord,
  MediaStore,
  StorageDriver,
  StorageManager,
  UploadSession,
  UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
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
      files: result.files.map((entry) => ({
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
    const stat = driver.stat ? await driver.stat(key) : { size: await driver.size(key) };
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

  async deleteObject(disk: string, key: string): Promise<void> {
    await this.diskOrThrow(disk).delete(key);
  }

  async copyObject(disk: string, from: string, to: string): Promise<void> {
    await this.diskOrThrow(disk).copy(from, to);
  }

  async moveObject(disk: string, from: string, to: string): Promise<void> {
    await this.diskOrThrow(disk).move(from, to);
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
