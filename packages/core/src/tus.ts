import { randomUUID } from 'node:crypto';
import { UploadOffsetConflictError, UploadSessionNotFoundError } from './errors';
import type { CreateUploadInput, ResumableUploadManager } from './resumable-upload';

export const TUS_VERSION = '1.0.0';

export interface TusRequest {
  method: 'OPTIONS' | 'POST' | 'HEAD' | 'PATCH' | 'DELETE';
  /** Upload id from the URL (for HEAD/PATCH/DELETE). */
  uploadId?: string;
  headers: Record<string, string | undefined>;
  body?: Buffer;
}

export interface TusResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
}

export interface TusUploadHandlerOptions {
  manager: ResumableUploadManager;
  /** Disk uploads land on. */
  disk: string;
  /** Base path the upload resources are exposed at, for the Location header. */
  basePath?: string;
  /** Reject creations whose Upload-Length exceeds this. */
  maxSize?: number;
  /** Compute the final object key. Default: `uploads/<token>/<filename>`. */
  keyFor?: (filename: string, token: string, metadata: Record<string, string>) => string;
  idGenerator?: () => string;
}

/** Parse a tus `Upload-Metadata` header (`key b64val,key2 b64val2`). */
export function parseTusMetadata(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(',')) {
    const [key, value] = pair.trim().split(' ');
    if (key) out[key] = value ? Buffer.from(value, 'base64').toString('utf8') : '';
  }
  return out;
}

/**
 * Framework-agnostic tus 1.0.0 server core (creation + termination extensions),
 * delegating storage to the ResumableUploadManager. A thin web-framework adapter
 * maps its HTTP request/response to/from `TusRequest`/`TusResponse`.
 */
export class TusUploadHandler {
  private readonly manager: ResumableUploadManager;
  private readonly disk: string;
  private readonly basePath: string;
  private readonly maxSize: number | undefined;
  private readonly keyFor: (f: string, t: string, m: Record<string, string>) => string;
  private readonly newId: () => string;

  constructor(options: TusUploadHandlerOptions) {
    this.manager = options.manager;
    this.disk = options.disk;
    this.basePath = options.basePath ?? '/uploads';
    this.maxSize = options.maxSize;
    this.keyFor = options.keyFor ?? ((filename, token) => `uploads/${token}/${filename}`);
    this.newId = options.idGenerator ?? (() => randomUUID());
  }

  async handle(req: TusRequest): Promise<TusResponse> {
    const base: Record<string, string> = { 'Tus-Resumable': TUS_VERSION };
    switch (req.method) {
      case 'OPTIONS':
        return {
          status: 204,
          headers: {
            ...base,
            'Tus-Version': TUS_VERSION,
            'Tus-Extension': 'creation,termination',
            ...(this.maxSize ? { 'Tus-Max-Size': String(this.maxSize) } : {}),
          },
        };

      case 'POST': {
        const length = Number(req.headers['upload-length']);
        if (this.maxSize && Number.isFinite(length) && length > this.maxSize) {
          return { status: 413, headers: base, body: 'Upload exceeds maximum size' };
        }
        const metadata = parseTusMetadata(req.headers['upload-metadata']);
        const filename = metadata.filename ?? 'upload';
        const token = this.newId();
        const input: CreateUploadInput = {
          disk: this.disk,
          key: this.keyFor(filename, token, metadata),
        };
        if (Number.isFinite(length)) input.size = length;
        if (metadata.filetype) input.contentType = metadata.filetype;
        const session = await this.manager.createUpload(input);
        return {
          status: 201,
          headers: { ...base, Location: `${this.basePath}/${session.id}`, 'Upload-Offset': '0' },
        };
      }

      case 'HEAD': {
        try {
          const status = await this.manager.status(req.uploadId ?? '');
          return {
            status: 200,
            headers: {
              ...base,
              'Upload-Offset': String(status.offset),
              ...(status.size != null ? { 'Upload-Length': String(status.size) } : {}),
              'Cache-Control': 'no-store',
            },
          };
        } catch (err) {
          if (err instanceof UploadSessionNotFoundError) return { status: 404, headers: base };
          throw err;
        }
      }

      case 'PATCH': {
        if (req.headers['content-type'] !== 'application/offset+octet-stream') {
          return { status: 415, headers: base, body: 'Unsupported Media Type' };
        }
        const offset = Number(req.headers['upload-offset']);
        try {
          const result = await this.manager.writeChunk(
            req.uploadId ?? '',
            offset,
            req.body ?? Buffer.alloc(0),
          );
          const status = await this.manager.status(req.uploadId ?? '');
          if (status.size != null && result.offset >= status.size) {
            await this.manager.complete(req.uploadId ?? '');
          }
          return { status: 204, headers: { ...base, 'Upload-Offset': String(result.offset) } };
        } catch (err) {
          if (err instanceof UploadOffsetConflictError) return { status: 409, headers: base };
          if (err instanceof UploadSessionNotFoundError) return { status: 404, headers: base };
          throw err;
        }
      }

      case 'DELETE':
        await this.manager.abort(req.uploadId ?? '');
        return { status: 204, headers: base };

      default:
        return { status: 405, headers: base };
    }
  }
}
