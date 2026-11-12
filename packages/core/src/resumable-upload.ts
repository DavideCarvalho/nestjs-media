import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { publishMedia } from './diagnostics';
import {
  InvalidPartNumberError,
  MediaTenancyUnavailableError,
  UnsupportedOperationError,
  UploadOffsetConflictError,
  UploadSessionNotFoundError,
} from './errors';
import { assertMediaKey } from './keys';
import { type MultipartDrivers, multipartFor } from './multipart';
import {
  type MediaTenancy,
  type MediaTenancyOption,
  type MediaTenantMatch,
  canSeeRow,
  readTenancy,
  rowTenantId,
} from './tenancy';
import type { MediaDisks, MultipartPart } from './types';

export interface UploadSession {
  id: string;
  disk: string;
  /** Final object key the assembled upload will be written to. */
  key: string;
  contentType: string | undefined;
  /** Total expected size in bytes, if known up front. */
  size: number | undefined;
  /** Bytes received so far (the resume offset). */
  offset: number;
  /** Number of chunk parts written so far. */
  parts: number;
  /** S3 (or other native-multipart) upload id, when the target disk is multipart-capable. */
  multipartUploadId?: string;
  /** When the session was created. Optional/additive — consumers (dashboard) omit age when absent. */
  createdAt?: Date;
  /**
   * Opaque application data attached at {@link ResumableUploadManager.createUpload} and carried
   * through to the `upload.start` / `upload.complete` diagnostics events. This library never reads
   * it — it exists so a host can correlate a finished upload back to whatever it was for (which
   * record, which collection, which workflow) without keeping its own side-table keyed by upload id,
   * and without the client having to call back in after the bytes land.
   */
  metadata?: Record<string, unknown>;
  /**
   * The tenant the session belongs to (`null` = none). Set only while tenancy is on; stores leave
   * it `undefined` otherwise and never read or write their tenant column.
   */
  tenantId?: string | null;
}

/** Optional filter for {@link UploadSessionStore.list}. */
export interface UploadSessionListFilter {
  /** Only sessions on this disk. */
  disk?: string;
  /** Only sessions whose `key` starts with this prefix. */
  keyPrefix?: string;
  /** Tenancy only (see {@link UploadSessionStore.enableTenancy}): keep only this tenant's sessions. */
  tenant?: MediaTenantMatch;
}

/** Persistence SPI for resumable upload sessions (in-memory impl in `-testing`). */
export interface UploadSessionStore {
  create(session: UploadSession): Promise<UploadSession>;
  get(id: string): Promise<UploadSession | null>;
  update(session: UploadSession): Promise<UploadSession>;
  delete(id: string): Promise<void>;
  /** Atomically record one part's ETag, keyed by partNumber. Enables parallel `writePart`. */
  addPart?(id: string, part: MultipartPart): Promise<void>;
  /** All recorded parts for a session (unordered). Used by `complete()` + resume. */
  listParts?(id: string): Promise<MultipartPart[]>;
  /**
   * List currently-stored (in-progress) sessions, optionally filtered. Admin-facing
   * (an "uploads in progress" view), not a hot path. Optional: stores that cannot
   * enumerate (or a minimal impl) omit it, and callers degrade to an empty list.
   */
  list?(filter?: UploadSessionListFilter): Promise<UploadSession[]>;
  /**
   * Switch the store to tenancy, as `MediaStore.enableTenancy`: verify (or add) the nullable
   * `tenant_id` column, throw `MediaTenancyUnavailableError` when missing, then persist and return
   * {@link UploadSession.tenantId} and honour `list`'s `tenant` filter. A store without it can't run
   * with tenancy on.
   */
  enableTenancy?(): Promise<void>;
}

export interface CreateUploadInput {
  disk: string;
  key: string;
  size?: number;
  contentType?: string;
  /** Opaque application data echoed back on the upload diagnostics events. See {@link UploadSession.metadata}. */
  metadata?: Record<string, unknown>;
  /** The tenant to stamp (`null` = none), instead of the request's. Used only while tenancy is on. */
  tenantId?: string | null;
}

export interface ResumableUploadManagerOptions {
  /** The disks: `Storage` from `@nestjs/storage`, or any {@link MediaDisks}. */
  storage: MediaDisks;
  /**
   * Native multipart side-cars by disk name. A session on such a disk uploads each chunk as a part
   * and the store assembles them; on other disks chunks are written as temporary files and
   * streamed into the final file on completion.
   */
  multipart?: MultipartDrivers;
  sessions: UploadSessionStore;
  /** Prefix for temporary chunk parts on the target disk. Default `.uploads`. Must be a valid key. */
  tmpPrefix?: string;
  idGenerator?: () => string;
  /** Emit `nestjs:media:upload.*` diagnostics events (default true). */
  emitDiagnostics?: boolean;
  /** Scope sessions by the request's tenant. Default `'inherit'` (see `MediaTenancyOption`). */
  tenancy?: MediaTenancyOption;
  /** The context's `CONTEXT_ACCESSOR`, when injected. Default: the global slot the context publishes. */
  contextAccessor?: unknown;
}

/**
 * Framework-agnostic resumable upload engine (the `proxy` path). Bytes flow through
 * the backend in chunks; each chunk is written immediately as a part on the target
 * disk, so a dropped connection resumes from `offset` without re-sending. `complete`
 * assembles the parts into the final object. A tus HTTP handler wraps this.
 */
export class ResumableUploadManager {
  private readonly storage: MediaDisks;
  private readonly multipart: MultipartDrivers | undefined;
  private readonly sessions: UploadSessionStore;
  private readonly tmpPrefix: string;
  private readonly newId: () => string;
  private readonly emitDiagnostics: boolean;
  private readonly tenancyOption: MediaTenancyOption;
  private readonly contextAccessor: unknown;
  private tenancyReady: Promise<void> | undefined;

  constructor(options: ResumableUploadManagerOptions) {
    this.storage = options.storage;
    this.multipart = options.multipart;
    this.sessions = options.sessions;
    this.tmpPrefix = (options.tmpPrefix ?? '.uploads').replace(/\/+$/, '');
    assertMediaKey(this.tmpPrefix);
    this.newId = options.idGenerator ?? (() => randomUUID());
    this.emitDiagnostics = options.emitDiagnostics ?? true;
    this.tenancyOption = options.tenancy ?? 'inherit';
    this.contextAccessor = options.contextAccessor;
  }

  /**
   * Fails fast when tenancy is on and the session store can't scope by tenant. `MediaModule` calls
   * it at boot; every operation also checks. Resolves to whether tenancy is on.
   */
  async prepareTenancy(): Promise<boolean> {
    return (await this.tenancy()).enabled;
  }

  private async tenancy(): Promise<MediaTenancy> {
    const tenancy = readTenancy(this.tenancyOption, this.contextAccessor);
    if (!tenancy.enabled) return tenancy;
    this.tenancyReady ??= this.enableStoreTenancy();
    await this.tenancyReady;
    return tenancy;
  }

  private async enableStoreTenancy(): Promise<void> {
    if (typeof this.sessions.enableTenancy !== 'function') {
      this.tenancyReady = undefined;
      throw new MediaTenancyUnavailableError(
        `the upload session store (${this.sessions.constructor?.name ?? 'custom'}) has no \`enableTenancy()\``,
        'Use a session store that supports tenancy (every first-party store does, from this version).',
      );
    }
    try {
      await this.sessions.enableTenancy();
    } catch (error) {
      this.tenancyReady = undefined;
      throw error;
    }
  }

  private partKey(session: UploadSession, part: number): string {
    return `${this.tmpPrefix}/${session.id}/${part}`;
  }

  async createUpload(input: CreateUploadInput): Promise<UploadSession> {
    assertMediaKey(input.key);
    const tenancy = await this.tenancy();
    // Resolves (and so validates) the disk name before anything is created.
    this.storage.disk(input.disk);
    const driver = multipartFor(this.multipart, input.disk);
    const multipart = driver
      ? {
          multipartUploadId: (
            await driver.createMultipartUpload(
              input.key,
              input.contentType ? { contentType: input.contentType } : undefined,
            )
          ).uploadId,
        }
      : {};
    const session = await this.sessions.create({
      id: this.newId(),
      disk: input.disk,
      key: input.key,
      contentType: input.contentType,
      size: input.size,
      offset: 0,
      parts: 0,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(tenancy.enabled
        ? { tenantId: input.tenantId !== undefined ? input.tenantId : rowTenantId(tenancy) }
        : {}),
      ...multipart,
    });
    this.emit('upload.start', {
      id: session.id,
      disk: session.disk,
      key: session.key,
      size: session.size,
      contentType: session.contentType,
      ...(session.metadata !== undefined ? { metadata: session.metadata } : {}),
    });
    return session;
  }

  /** Append a chunk at `offset` (must equal the session's current offset). Returns the new offset. */
  async writeChunk(id: string, offset: number, chunk: Buffer): Promise<{ offset: number }> {
    const session = await this.require(id);
    if (offset !== session.offset) {
      throw new UploadOffsetConflictError(session.offset, offset);
    }
    const driver = multipartFor(this.multipart, session.disk);
    if (session.multipartUploadId && driver) {
      if (typeof this.sessions.addPart !== 'function') {
        throw new UnsupportedOperationError('session store', 'multipart part recording');
      }
      const part = await driver.uploadPart(
        session.key,
        session.multipartUploadId,
        session.parts + 1,
        chunk,
      );
      await this.sessions.addPart(id, part);
    } else {
      await this.storage.disk(session.disk).put(this.partKey(session, session.parts), chunk);
    }
    session.parts += 1;
    session.offset += chunk.byteLength;
    await this.sessions.update(session);
    this.emit('upload.progress', {
      id: session.id,
      offset: session.offset,
      parts: session.parts,
      size: session.size,
    });
    return { offset: session.offset };
  }

  /**
   * Upload ONE S3 multipart part by explicit number (the parallel path). Unlike
   * `writeChunk` this does not touch `offset`/`parts` and does not auto-complete —
   * the client uploads parts concurrently, then calls `complete()`. Requires a
   * session store with atomic `addPart` (no read-modify-write fallback is safe
   * under concurrency).
   */
  async writePart(id: string, partNumber: number, chunk: Buffer): Promise<MultipartPart> {
    const session = await this.require(id);
    const driver = multipartFor(this.multipart, session.disk);
    if (!session.multipartUploadId || !driver) {
      throw new UnsupportedOperationError(session.disk, 'parallel multipart upload');
    }
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new InvalidPartNumberError(partNumber);
    }
    if (typeof this.sessions.addPart !== 'function') {
      throw new UnsupportedOperationError('session store', 'concurrent part writes');
    }
    const part = await driver.uploadPart(session.key, session.multipartUploadId, partNumber, chunk);
    await this.sessions.addPart(id, part);
    this.emit('upload.progress', {
      id: session.id,
      offset: session.offset,
      parts: partNumber,
      size: session.size,
    });
    return part;
  }

  /** All recorded parts for a session (both write paths record via the store side-index). */
  async listParts(id: string): Promise<MultipartPart[]> {
    await this.require(id);
    return (await this.sessions.listParts?.(id)) ?? [];
  }

  async status(id: string): Promise<{ offset: number; size: number | undefined }> {
    const session = await this.require(id);
    return { offset: session.offset, size: session.size };
  }

  /** Assemble all parts into the final object, clean up, and return the final key. */
  async complete(id: string): Promise<{ key: string; disk: string; size: number }> {
    const session = await this.require(id);
    const driver = multipartFor(this.multipart, session.disk);

    if (session.multipartUploadId && driver) {
      // Both write paths (sequential writeChunk and parallel writePart) record parts
      // via the store's part side-index. Sort ascending, which S3 requires for
      // completeMultipartUpload.
      const parts = [...((await this.sessions.listParts?.(id)) ?? [])].sort(
        (a, b) => a.partNumber - b.partNumber,
      );
      await driver.completeMultipartUpload(session.key, session.multipartUploadId, parts);
    } else {
      await this.storage
        .disk(session.disk)
        .put(session.key, Readable.from(this.readParts(session)), {
          ...(session.contentType ? { contentType: session.contentType } : {}),
          // The bytes received, so a missing or extra part fails the write instead of landing.
          contentLength: session.offset,
        });
    }

    await this.cleanup(session);
    await this.sessions.delete(id);
    // Parallel writePart() never advances session.offset (only writeChunk does), so on
    // that path offset stays 0. Report the declared total when known; offset remains the
    // correct value for the sequential path (where offset === size by construction).
    const size = session.size ?? session.offset;
    this.emit('upload.complete', {
      id: session.id,
      disk: session.disk,
      key: session.key,
      size,
      ...(session.metadata !== undefined ? { metadata: session.metadata } : {}),
    });
    return { key: session.key, disk: session.disk, size };
  }

  async abort(id: string): Promise<void> {
    const session = await this.find(id);
    if (!session) return;
    const driver = multipartFor(this.multipart, session.disk);
    if (session.multipartUploadId && driver) {
      await driver.abortMultipartUpload(session.key, session.multipartUploadId);
    }
    await this.cleanup(session);
    await this.sessions.delete(id);
    this.emit('upload.abort', { id: session.id });
  }

  private emit<E extends 'upload.start' | 'upload.progress' | 'upload.complete' | 'upload.abort'>(
    event: E,
    payload: Parameters<typeof publishMedia<E>>[1],
  ): void {
    if (this.emitDiagnostics) publishMedia(event, payload);
  }

  /** The session's parts in order, each opened only once the previous one is drained, so the
   *  assembled object is never held in memory. */
  private async *readParts(session: UploadSession): AsyncGenerator<Buffer> {
    const disk = this.storage.disk(session.disk);
    for (let part = 0; part < session.parts; part += 1) {
      const { body } = await disk.get(this.partKey(session, part));
      for await (const chunk of body) {
        yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
    }
  }

  private async cleanup(session: UploadSession): Promise<void> {
    if (session.multipartUploadId) return;
    const keys = Array.from({ length: session.parts }, (_, part) => this.partKey(session, part));
    await this.storage.disk(session.disk).delete(keys);
  }

  /** A session the request's tenant can see, else `null` (a hidden one reads as missing). */
  private async find(id: string): Promise<UploadSession | null> {
    const tenancy = await this.tenancy();
    const session = await this.sessions.get(id);
    return session && canSeeRow(tenancy, session.tenantId) ? session : null;
  }

  private async require(id: string): Promise<UploadSession> {
    const session = await this.find(id);
    if (!session) throw new UploadSessionNotFoundError(id);
    return session;
  }
}
