import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { StorageSignedUrlRequest } from '@nestjs/storage';
import { type MediaDiagnosticPayloads, publishMedia } from './diagnostics';
import {
  ConversionNotDefinedError,
  ImageProcessorMissingError,
  MediaNotFoundError,
  MediaTenancyUnavailableError,
  MimeNotAllowedError,
} from './errors';
import type { ConversionPreset, ImageProcessor } from './image-processor';
import { keySegment } from './keys';
import { type MediaCollectionConfig, MediaCollectionRegistry } from './media-collection';
import type { MediaConversion, MediaRecord } from './media-record';
import type { MediaStore } from './media-store';
import { deleteKeys, fileUrl } from './storage-helpers';
import {
  type MediaTenancy,
  type MediaTenancyOption,
  canSeeRow,
  matchesTenant,
  readTenancy,
  rowTenantId,
  tenantMatch,
} from './tenancy';
import type { MediaDisks } from './types';

export interface MediaLibraryOptions {
  /** The disks: `Storage` from `@nestjs/storage`, or any {@link MediaDisks}. */
  storage: MediaDisks;
  store: MediaStore;
  collections?: MediaCollectionConfig[];
  /** Engine for image conversions. Required only if collections define conversions. */
  imageProcessor?: ImageProcessor;
  /** Emit `nestjs:media:*` diagnostics events (default true). */
  emitDiagnostics?: boolean;
  /** Injectable for deterministic tests. Defaults to `randomUUID`. */
  idGenerator?: () => string;
  /** Injectable for deterministic tests. Defaults to `() => new Date()`. */
  clock?: () => Date;
  /**
   * Scope records by the request's tenant (from `@dudousxd/nestjs-context`). Default `'inherit'`:
   * on only when the context turns tenancy on. See {@link MediaTenancyOption}.
   */
  tenancy?: MediaTenancyOption;
  /** The context's `CONTEXT_ACCESSOR`, when injected. Default: the global slot the context publishes. */
  contextAccessor?: unknown;
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
  /**
   * The tenant to stamp (`null` = none), instead of the request's tenant. Used only while tenancy
   * is on; ignored otherwise.
   */
  tenantId?: string | null;
}

/**
 * An owning entity bound to the library, so collection operations don't repeat
 * `ownerType`/`ownerId`. This is the table-model equivalent of spatie's
 * `HasMedia`/`InteractsWithMedia` — you get it from {@link MediaLibrary.for}.
 */
export interface OwnerMediaBinding {
  /** Attach a file to one of this owner's collections. */
  attach(input: Omit<AttachInput, 'ownerType' | 'ownerId'>): Promise<MediaRecord>;
  /** List this owner's media — all collections, or one. */
  list(collection?: string): Promise<MediaRecord[]>;
}

export class MediaLibrary {
  private readonly storage: MediaDisks;
  private readonly store: MediaStore;
  private readonly collections: MediaCollectionRegistry;
  private readonly imageProcessor: ImageProcessor | undefined;
  private readonly emitDiagnostics: boolean;
  private readonly newId: () => string;
  private readonly now: () => Date;
  private readonly conversionsInFlight = new Map<string, Promise<MediaRecord>>();
  private readonly tenancyOption: MediaTenancyOption;
  private readonly contextAccessor: unknown;
  private tenancyReady: Promise<void> | undefined;

  constructor(options: MediaLibraryOptions) {
    this.storage = options.storage;
    this.store = options.store;
    this.collections = new MediaCollectionRegistry(options.collections ?? []);
    this.imageProcessor = options.imageProcessor;
    this.emitDiagnostics = options.emitDiagnostics ?? true;
    this.newId = options.idGenerator ?? (() => randomUUID());
    this.now = options.clock ?? (() => new Date());
    this.tenancyOption = options.tenancy ?? 'inherit';
    this.contextAccessor = options.contextAccessor;
  }

  /**
   * Fails fast when tenancy is on and the store can't scope by tenant (no `tenant_id` column, or
   * a store without tenancy support). `MediaModule` calls it at boot; every operation also checks.
   * Resolves to whether tenancy is on.
   */
  async prepareTenancy(): Promise<boolean> {
    return (await this.tenancy()).enabled;
  }

  /** The tenancy of this operation; with tenancy on, the store is switched to it first. */
  private async tenancy(): Promise<MediaTenancy> {
    const tenancy = readTenancy(this.tenancyOption, this.contextAccessor);
    if (!tenancy.enabled) return tenancy;
    this.tenancyReady ??= this.enableStoreTenancy();
    await this.tenancyReady;
    return tenancy;
  }

  private async enableStoreTenancy(): Promise<void> {
    if (typeof this.store.enableTenancy !== 'function') {
      this.tenancyReady = undefined;
      throw new MediaTenancyUnavailableError(
        `the media store (${this.store.constructor?.name ?? 'custom'}) has no \`enableTenancy()\``,
        'Use a store that supports tenancy (every first-party store does, from this version).',
      );
    }
    try {
      await this.store.enableTenancy();
    } catch (error) {
      // Not cached: a store fixed later (a migration ran) is retried on the next call.
      this.tenancyReady = undefined;
      throw error;
    }
  }

  /** A record by id, or `null` when there is none or the request's tenant can't see it. */
  async get(id: string): Promise<MediaRecord | null> {
    const tenancy = await this.tenancy();
    const record = await this.store.find(id);
    return record && canSeeRow(tenancy, record.tenantId) ? record : null;
  }

  private async require(id: string): Promise<MediaRecord> {
    const record = await this.get(id);
    if (!record) throw new MediaNotFoundError(id);
    return record;
  }

  private emit<E extends 'attach' | 'delete' | 'conversion'>(
    event: E,
    payload: MediaDiagnosticPayloads[E],
  ): void {
    if (this.emitDiagnostics) publishMedia(event, payload);
  }

  async attach(input: AttachInput): Promise<MediaRecord> {
    const config = this.collections.get(input.collection);
    const tenancy = await this.tenancy();

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
      const match = tenantMatch(tenancy);
      for (const record of existing) {
        if (matchesTenant(match, record.tenantId)) await this.delete(record.id);
      }
    }

    const disk = input.disk ?? config.disk ?? this.storage.defaultDisk;
    const id = this.newId();
    // Every segment goes through keySegment(): the file name (and owner ids) come from users,
    // and @nestjs/storage refuses `..`, empty segments, backslashes and control characters.
    const path = [input.ownerType, input.ownerId, input.collection, id, input.fileName]
      .map(keySegment)
      .join('/');

    const written = await this.storage.disk(disk).put(path, input.contents, {
      contentType: input.mimeType,
      ...(input.size !== undefined ? { contentLength: input.size } : {}),
    });
    const size = input.size ?? written.size;
    const order = await this.store.nextOrder(input.ownerType, input.ownerId, input.collection);
    const timestamp = this.now();

    const saved = await this.store.save({
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
      ...(tenancy.enabled
        ? { tenantId: input.tenantId !== undefined ? input.tenantId : rowTenantId(tenancy) }
        : {}),
    });

    this.emit('attach', {
      id: saved.id,
      ownerType: saved.ownerType,
      ownerId: saved.ownerId,
      collection: saved.collection,
      disk: saved.disk,
      path: saved.path,
      size: saved.size,
      mimeType: saved.mimeType,
    });

    // Eager presets are generated synchronously now (the durable/bullmq dispatcher
    // is a later phase; sync is the baseline fallback).
    const eager = (config.conversions ?? []).filter((p) => p.eager);
    if (eager.length === 0) return saved;
    if (!this.imageProcessor) throw new ImageProcessorMissingError();
    const original = Buffer.isBuffer(input.contents)
      ? input.contents
      : await this.storage.disk(disk).getBuffer(path);
    const generated: Record<string, MediaConversion> = {};
    try {
      for (const preset of eager) {
        if (generated[preset.name]) continue;
        generated[preset.name] = await this.generateConversion(saved, preset, original);
      }
    } catch (error) {
      if (Object.keys(generated).length > 0) await this.saveConversions(saved, generated);
      throw error;
    }
    return this.saveConversions(saved, generated);
  }

  /**
   * Generate (if absent) and persist a named conversion; returns the updated record. Lazy entry point.
   * Concurrent calls for the same media and conversion share one generation.
   */
  async ensureConversion(id: string, conversionName: string): Promise<MediaRecord> {
    // Checked per caller before joining a shared generation, so a record another tenant is
    // converting stays not-found here.
    const record = await this.require(id);
    if (record.conversions[conversionName]) return record;
    const key = `${id}\u0000${conversionName}`;
    const pending = this.conversionsInFlight.get(key);
    if (pending) return pending;
    const run = this.ensureConversionNow(record, conversionName).finally(() => {
      this.conversionsInFlight.delete(key);
    });
    this.conversionsInFlight.set(key, run);
    return run;
  }

  private async ensureConversionNow(
    record: MediaRecord,
    conversionName: string,
  ): Promise<MediaRecord> {
    const preset = (this.collections.get(record.collection).conversions ?? []).find(
      (p) => p.name === conversionName,
    );
    if (!preset) throw new ConversionNotDefinedError(record.collection, conversionName);
    if (!this.imageProcessor) throw new ImageProcessorMissingError();

    const original = await this.storage.disk(record.disk).getBuffer(record.path);
    const conversion = await this.generateConversion(record, preset, original);
    return this.saveConversions(record, { [conversionName]: conversion });
  }

  /** Convert `original` with `preset` and write the variant beside the record's file. */
  private async generateConversion(
    record: MediaRecord,
    preset: ConversionPreset,
    original: Buffer,
  ): Promise<MediaConversion> {
    if (!this.imageProcessor) throw new ImageProcessorMissingError();
    const result = await this.imageProcessor.convert(original, preset);
    const dir = record.path.slice(0, record.path.lastIndexOf('/'));
    const conversionPath = `${dir}/conversions/${preset.name}.${result.format}`;
    await this.storage.disk(record.disk).put(conversionPath, result.data, {
      contentType: result.contentType,
    });
    return { path: conversionPath, disk: record.disk };
  }

  private async saveConversions(
    record: MediaRecord,
    conversions: Record<string, MediaConversion>,
  ): Promise<MediaRecord> {
    const updated = await this.store.save({
      ...record,
      conversions: { ...record.conversions, ...conversions },
      updatedAt: this.now(),
    });
    for (const [conversion, { path }] of Object.entries(conversions)) {
      this.emit('conversion', { id: record.id, conversion, path });
    }
    return updated;
  }

  /** An owner's records (all collections, or one), ordered; only those the request's tenant can see. */
  async list(ownerType: string, ownerId: string, collection?: string): Promise<MediaRecord[]> {
    const tenancy = await this.tenancy();
    const records = await this.store.listByOwner(ownerType, ownerId, collection);
    const match = tenantMatch(tenancy);
    return match ? records.filter((r) => matchesTenant(match, r.tenantId)) : records;
  }

  /**
   * Bind an owning entity so collection operations don't repeat its type/id:
   * `const m = media.library.for('Post', post.id); await m.attach({ collection, ... })`.
   * The id is coerced to a string to match how stores key owners.
   */
  for(ownerType: string, ownerId: string | number): OwnerMediaBinding {
    const ownerId_ = String(ownerId);
    return {
      attach: (input) => this.attach({ ...input, ownerType, ownerId: ownerId_ }),
      list: (collection) => this.list(ownerType, ownerId_, collection),
    };
  }

  async delete(id: string): Promise<void> {
    const record = await this.get(id);
    if (!record) return;
    await deleteKeys(this.storage, [
      { disk: record.disk, path: record.path },
      ...Object.values(record.conversions),
    ]);
    await this.store.delete(id);
    this.emit('delete', { id, ownerType: record.ownerType, ownerId: record.ownerId });
  }

  /**
   * Where a record (or one of its conversions) is stored, with the file name to serve it under.
   * A conversion not generated yet is generated first (and cached), as with {@link url}.
   */
  async locate(
    id: string,
    conversion?: string,
  ): Promise<{ record: MediaRecord; disk: string; path: string; fileName: string }> {
    if (conversion) {
      const record = await this.ensureConversion(id, conversion);
      const variant = record.conversions[conversion];
      if (!variant) throw new MediaNotFoundError(`${id}#${conversion}`);
      const ext = variant.path.slice(variant.path.lastIndexOf('.'));
      return {
        record,
        disk: variant.disk,
        path: variant.path,
        fileName: `${stripExtension(record.fileName)}-${conversion}${ext}`,
      };
    }
    const record = await this.require(id);
    return { record, disk: record.disk, path: record.path, fileName: record.fileName };
  }

  /**
   * A URL for a media record or one of its conversions: the disk's public URL when it has a
   * `publicUrl`, else a signed, expiring one (`signedUrl()`, 15 minutes unless `options` say
   * otherwise). A disk with neither (a local disk without `signedUrls`) throws the disk's own
   * `StorageError`; serve those files through your app with `MediaService.serve()`.
   * A conversion not generated yet is produced lazily (and cached) first.
   */
  async url(id: string, conversion?: string, options?: StorageSignedUrlRequest): Promise<string> {
    const target = await this.locate(id, conversion);
    return fileUrl(this.storage.disk(target.disk), target.path, options);
  }
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
