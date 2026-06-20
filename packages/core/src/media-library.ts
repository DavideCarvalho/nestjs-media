import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { MediaNotFoundError, MimeNotAllowedError } from './errors';
import { type MediaCollectionConfig, MediaCollectionRegistry } from './media-collection';
import type { MediaRecord } from './media-record';
import type { MediaStore } from './media-store';
import type { StorageManager } from './storage-manager';

export interface MediaLibraryOptions {
  storage: StorageManager;
  store: MediaStore;
  collections?: MediaCollectionConfig[];
  /** Injectable for deterministic tests. Defaults to `randomUUID`. */
  idGenerator?: () => string;
  /** Injectable for deterministic tests. Defaults to `() => new Date()`. */
  clock?: () => Date;
}

export interface AttachInput {
  ownerType: string;
  ownerId: string;
  collection: string;
  fileName: string;
  mimeType: string;
  contents: Buffer | Readable;
  /** Known byte size; when omitted it is read back from the disk after writing. */
  size?: number;
  name?: string;
  customProperties?: Record<string, unknown>;
  /** Disk override (else collection disk, else storage default). */
  disk?: string;
}

export class MediaLibrary {
  private readonly storage: StorageManager;
  private readonly store: MediaStore;
  private readonly collections: MediaCollectionRegistry;
  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(options: MediaLibraryOptions) {
    this.storage = options.storage;
    this.store = options.store;
    this.collections = new MediaCollectionRegistry(options.collections ?? []);
    this.newId = options.idGenerator ?? (() => randomUUID());
    this.now = options.clock ?? (() => new Date());
  }

  async attach(input: AttachInput): Promise<MediaRecord> {
    const config = this.collections.get(input.collection);

    if (config.acceptsMimeTypes && !config.acceptsMimeTypes.includes(input.mimeType)) {
      throw new MimeNotAllowedError(input.collection, input.mimeType);
    }

    // A single-file collection replaces whatever is already there.
    if (config.single) {
      const existing = await this.store.listByOwner(
        input.ownerType,
        input.ownerId,
        input.collection,
      );
      for (const record of existing) await this.delete(record.id);
    }

    const disk = input.disk ?? config.disk ?? this.storage.defaultDisk;
    const id = this.newId();
    const path = `${input.ownerType}/${input.ownerId}/${input.collection}/${id}/${input.fileName}`;

    await this.storage.disk(disk).put(path, input.contents, { contentType: input.mimeType });
    const size = input.size ?? (await this.storage.disk(disk).size(path));
    const order = await this.store.nextOrder(input.ownerType, input.ownerId, input.collection);
    const timestamp = this.now();

    return this.store.save({
      id,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      collection: input.collection,
      name: input.name ?? stripExtension(input.fileName),
      fileName: input.fileName,
      mimeType: input.mimeType,
      size,
      disk,
      path,
      order,
      customProperties: input.customProperties ?? {},
      conversions: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  list(ownerType: string, ownerId: string, collection?: string): Promise<MediaRecord[]> {
    return this.store.listByOwner(ownerType, ownerId, collection);
  }

  async delete(id: string): Promise<void> {
    const record = await this.store.find(id);
    if (!record) return;
    await this.storage.disk(record.disk).delete(record.path);
    for (const conversion of Object.values(record.conversions)) {
      await this.storage.disk(conversion.disk).delete(conversion.path);
    }
    await this.store.delete(id);
  }

  /** Public/temporary URL for a media record or one of its conversions. */
  async url(id: string, conversion?: string): Promise<string> {
    const record = await this.store.find(id);
    if (!record) throw new MediaNotFoundError(id);
    if (conversion) {
      const variant = record.conversions[conversion];
      if (!variant) throw new MediaNotFoundError(`${id}#${conversion}`);
      return this.storage.disk(variant.disk).url(variant.path);
    }
    return this.storage.disk(record.disk).url(record.path);
  }
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
