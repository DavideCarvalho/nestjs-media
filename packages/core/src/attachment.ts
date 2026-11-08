import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { StorageSignedUrlRequest } from '@nestjs/storage';
import { publishMedia } from './diagnostics';
import type { ConversionPreset, ImageProcessor } from './image-processor';
import { keySegment } from './keys';
import { deleteKeys, fileUrl } from './storage-helpers';
import type { MediaDisks } from './types';

export interface AttachmentVariant {
  disk: string;
  path: string;
  size: number;
  mimeType: string;
}

/** Plain, JSON-serializable shape stored in a model column. */
export interface AttachmentData {
  name: string;
  disk: string;
  path: string;
  size: number;
  mimeType: string;
  variants: Record<string, AttachmentVariant>;
  meta: Record<string, unknown>;
}

/**
 * A file attached to a model as a column value (adonis-attachment style). Pure value
 * object — it carries disk + path + variant metadata and serializes to JSON. URL
 * resolution and deletion go through `AttachmentManager` (which holds the disks).
 */
export class Attachment {
  readonly name: string;
  readonly disk: string;
  readonly path: string;
  readonly size: number;
  readonly mimeType: string;
  readonly variants: Record<string, AttachmentVariant>;
  readonly meta: Record<string, unknown>;

  constructor(data: AttachmentData) {
    this.name = data.name;
    this.disk = data.disk;
    this.path = data.path;
    this.size = data.size;
    this.mimeType = data.mimeType;
    this.variants = data.variants;
    this.meta = data.meta;
  }

  toJSON(): AttachmentData {
    return {
      name: this.name,
      disk: this.disk,
      path: this.path,
      size: this.size,
      mimeType: this.mimeType,
      variants: this.variants,
      meta: this.meta,
    };
  }

  /** Rebuild from a stored column value; returns null for null/undefined. */
  static fromJSON(json: AttachmentData | null | undefined): Attachment | null {
    return json ? new Attachment(json) : null;
  }
}

export interface CreateAttachmentInput {
  fileName: string;
  mimeType: string;
  contents: Buffer | Readable;
  size?: number;
}

export interface CreateAttachmentOptions {
  disk?: string;
  /** Key prefix on the disk. Default `attachments`. */
  keyPrefix?: string;
  /**
   * Deterministic id segment for the key, replacing the generated UUID. Use for
   * idempotent overwrites (e.g. a durable step that re-renders the same file): a
   * fixed id yields a fixed key that `put()` overwrites on retry, instead of
   * orphaning the prior object under a fresh UUID.
   */
  id?: string;
  /** Image variants to generate eagerly (needs an ImageProcessor). */
  variants?: ConversionPreset[];
  /** Display name override (defaults to the file name). */
  name?: string;
  meta?: Record<string, unknown>;
}

export interface AttachmentManagerOptions {
  /** The disks: `Storage` from `@nestjs/storage`, or any {@link MediaDisks}. */
  storage: MediaDisks;
  imageProcessor?: ImageProcessor;
  keyPrefix?: string;
  idGenerator?: () => string;
  /** Emit `nestjs:media:attachment.*` diagnostics events (default true). */
  emitDiagnostics?: boolean;
}

/**
 * Creates and resolves {@link Attachment}s — the adonis-attachment-style API.
 * `createFromFile` uploads the bytes (and any variants) and returns a value object
 * you assign to a model column; the ORM integrations serialize it via `toJSON`.
 */
export class AttachmentManager {
  private readonly storage: MediaDisks;
  private readonly imageProcessor: ImageProcessor | undefined;
  private readonly keyPrefix: string;
  private readonly newId: () => string;
  private readonly emitDiagnostics: boolean;

  constructor(options: AttachmentManagerOptions) {
    this.storage = options.storage;
    this.imageProcessor = options.imageProcessor;
    this.keyPrefix = options.keyPrefix ?? 'attachments';
    this.newId = options.idGenerator ?? (() => randomUUID());
    this.emitDiagnostics = options.emitDiagnostics ?? true;
  }

  async createFromFile(
    input: CreateAttachmentInput,
    options: CreateAttachmentOptions = {},
  ): Promise<Attachment> {
    const disk = options.disk ?? this.storage.defaultDisk;
    const prefix = options.keyPrefix ?? this.keyPrefix;
    const id = options.id ?? this.newId();
    const dir = `${prefix}/${keySegment(id)}`;
    const path = `${dir}/${keySegment(input.fileName)}`;

    const written = await this.storage.disk(disk).put(path, input.contents, {
      contentType: input.mimeType,
      ...(input.size !== undefined ? { contentLength: input.size } : {}),
    });
    const size = input.size ?? written.size;

    const variants: Record<string, AttachmentVariant> = {};
    const presets = options.variants ?? [];
    if (presets.length > 0) {
      if (!this.imageProcessor) {
        throw new Error(
          'AttachmentManager: variants requested but no ImageProcessor was configured',
        );
      }
      const original = await this.storage.disk(disk).getBuffer(path);
      for (const preset of presets) {
        const result = await this.imageProcessor.convert(original, preset);
        const variantPath = `${dir}/variants/${preset.name}.${result.format}`;
        await this.storage.disk(disk).put(variantPath, result.data, {
          contentType: result.contentType,
        });
        variants[preset.name] = {
          disk,
          path: variantPath,
          size: result.data.byteLength,
          mimeType: result.contentType,
        };
      }
    }

    const attachment = new Attachment({
      name: options.name ?? input.fileName,
      disk,
      path,
      size,
      mimeType: input.mimeType,
      variants,
      meta: options.meta ?? {},
    });

    if (this.emitDiagnostics) {
      publishMedia('attachment.create', {
        disk,
        path,
        size,
        mimeType: attachment.mimeType,
        name: attachment.name,
        variants: Object.keys(variants),
      });
    }
    return attachment;
  }

  /**
   * A URL for the attachment, or a named variant: the disk's public URL when it has a
   * `publicUrl`, else a signed, expiring one (`options.expiresIn`, default 15 minutes).
   */
  async url(
    attachment: Attachment,
    variant?: string,
    options?: StorageSignedUrlRequest,
  ): Promise<string> {
    const target = this.resolve(attachment, variant);
    return fileUrl(this.storage.disk(target.disk), target.path, options);
  }

  /** A signed, expiring URL even when the disk has a public one (`signedUrl()`). */
  async signedUrl(
    attachment: Attachment,
    variant?: string,
    options?: StorageSignedUrlRequest,
  ): Promise<string> {
    const target = this.resolve(attachment, variant);
    return this.storage.disk(target.disk).signedUrl(target.path, options);
  }

  /** Remove the attachment and all its variants from storage. */
  async delete(attachment: Attachment): Promise<void> {
    await deleteKeys(this.storage, [attachment, ...Object.values(attachment.variants)]);
    if (this.emitDiagnostics) {
      publishMedia('attachment.delete', {
        disk: attachment.disk,
        path: attachment.path,
        variants: Object.keys(attachment.variants),
      });
    }
  }

  private resolve(attachment: Attachment, variant?: string): { disk: string; path: string } {
    if (!variant) return { disk: attachment.disk, path: attachment.path };
    const v = attachment.variants[variant];
    if (!v) throw new Error(`Attachment has no variant "${variant}"`);
    return { disk: v.disk, path: v.path };
  }
}
