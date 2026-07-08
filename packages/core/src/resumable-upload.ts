import { randomUUID } from 'node:crypto';
import { publishMedia } from './diagnostics';
import { UploadOffsetConflictError, UploadSessionNotFoundError } from './errors';
import { isMultipartCapable } from './multipart';
import type { StorageManager } from './storage-manager';
import type { MultipartPart } from './types';

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
  /** ETags of uploaded parts, in order, for the native-multipart complete. */
  partETags?: MultipartPart[];
}

/** Persistence SPI for resumable upload sessions (in-memory impl in `-testing`). */
export interface UploadSessionStore {
  create(session: UploadSession): Promise<UploadSession>;
  get(id: string): Promise<UploadSession | null>;
  update(session: UploadSession): Promise<UploadSession>;
  delete(id: string): Promise<void>;
}

export interface CreateUploadInput {
  disk: string;
  key: string;
  size?: number;
  contentType?: string;
}

export interface ResumableUploadManagerOptions {
  storage: StorageManager;
  sessions: UploadSessionStore;
  /** Prefix for temporary chunk parts on the target disk. Default `.uploads`. */
  tmpPrefix?: string;
  idGenerator?: () => string;
  /** Emit `nestjs:media:upload.*` diagnostics events (default true). */
  emitDiagnostics?: boolean;
}

/**
 * Framework-agnostic resumable upload engine (the `proxy` path). Bytes flow through
 * the backend in chunks; each chunk is written immediately as a part on the target
 * disk, so a dropped connection resumes from `offset` without re-sending. `complete`
 * assembles the parts into the final object. A tus HTTP handler wraps this.
 */
export class ResumableUploadManager {
  private readonly storage: StorageManager;
  private readonly sessions: UploadSessionStore;
  private readonly tmpPrefix: string;
  private readonly newId: () => string;
  private readonly emitDiagnostics: boolean;

  constructor(options: ResumableUploadManagerOptions) {
    this.storage = options.storage;
    this.sessions = options.sessions;
    this.tmpPrefix = options.tmpPrefix ?? '.uploads';
    this.newId = options.idGenerator ?? (() => randomUUID());
    this.emitDiagnostics = options.emitDiagnostics ?? true;
  }

  private partKey(session: UploadSession, part: number): string {
    return `${this.tmpPrefix}/${session.id}/${part}`;
  }

  async createUpload(input: CreateUploadInput): Promise<UploadSession> {
    const disk = this.storage.disk(input.disk);
    const multipart = isMultipartCapable(disk)
      ? {
          multipartUploadId: (
            await disk.createMultipartUpload(
              input.key,
              input.contentType ? { contentType: input.contentType } : undefined,
            )
          ).uploadId,
          partETags: [] as MultipartPart[],
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
      ...multipart,
    });
    this.emit('upload.start', {
      id: session.id,
      disk: session.disk,
      key: session.key,
      size: session.size,
      contentType: session.contentType,
    });
    return session;
  }

  /** Append a chunk at `offset` (must equal the session's current offset). Returns the new offset. */
  async writeChunk(id: string, offset: number, chunk: Buffer): Promise<{ offset: number }> {
    const session = await this.require(id);
    if (offset !== session.offset) {
      throw new UploadOffsetConflictError(session.offset, offset);
    }
    const disk = this.storage.disk(session.disk);
    if (session.multipartUploadId && isMultipartCapable(disk)) {
      const part = await disk.uploadPart(
        session.key,
        session.multipartUploadId,
        session.parts + 1,
        chunk,
      );
      session.partETags = [...(session.partETags ?? []), part];
    } else {
      await disk.put(this.partKey(session, session.parts), chunk);
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

  async status(id: string): Promise<{ offset: number; size: number | undefined }> {
    const session = await this.require(id);
    return { offset: session.offset, size: session.size };
  }

  /** Assemble all parts into the final object, clean up, and return the final key. */
  async complete(id: string): Promise<{ key: string; disk: string; size: number }> {
    const session = await this.require(id);
    const disk = this.storage.disk(session.disk);

    if (session.multipartUploadId && isMultipartCapable(disk)) {
      await disk.completeMultipartUpload(session.key, session.multipartUploadId, session.partETags ?? []);
    } else {
      const chunks: Buffer[] = [];
      for (let part = 0; part < session.parts; part += 1) {
        chunks.push(await disk.get(this.partKey(session, part)));
      }
      await disk.put(
        session.key,
        Buffer.concat(chunks),
        session.contentType ? { contentType: session.contentType } : {},
      );
    }

    await this.cleanup(session);
    await this.sessions.delete(id);
    this.emit('upload.complete', {
      id: session.id,
      disk: session.disk,
      key: session.key,
      size: session.offset,
    });
    return { key: session.key, disk: session.disk, size: session.offset };
  }

  async abort(id: string): Promise<void> {
    const session = await this.sessions.get(id);
    if (!session) return;
    const disk = this.storage.disk(session.disk);
    if (session.multipartUploadId && isMultipartCapable(disk)) {
      await disk.abortMultipartUpload(session.key, session.multipartUploadId);
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

  private async cleanup(session: UploadSession): Promise<void> {
    if (session.multipartUploadId) return;
    const disk = this.storage.disk(session.disk);
    for (let part = 0; part < session.parts; part += 1) {
      await disk.delete(this.partKey(session, part));
    }
  }

  private async require(id: string): Promise<UploadSession> {
    const session = await this.sessions.get(id);
    if (!session) throw new UploadSessionNotFoundError(id);
    return session;
  }
}
