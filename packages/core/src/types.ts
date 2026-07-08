import type { Readable } from 'node:stream';

export type Visibility = 'public' | 'private';

export interface PutOptions {
  contentType?: string;
  visibility?: Visibility;
  metadata?: Record<string, string>;
}

export interface ListOptions {
  /** Delimiter that rolls deeper keys up into folder prefixes. Default '/'. */
  delimiter?: string;
  /** Opaque pagination cursor from a previous ListResult. */
  cursor?: string;
  /** Max entries per page. */
  limit?: number;
  /** Override the driver's configured bucket/root (admin cross-bucket browse). Ignored by drivers without a bucket concept. */
  bucket?: string;
}

export interface ListEntry {
  /** Full key relative to the bucket/root. */
  key: string;
  /** Last path segment (file or folder name, no trailing slash). */
  name: string;
  sizeBytes: number | null;
  lastModified: Date | null;
}

export interface ListResult {
  /** Sub-folder prefixes (each ends in the delimiter), from CommonPrefixes. */
  folders: string[];
  /** File entries directly under the prefix. */
  files: ListEntry[];
  /** Present when the result is truncated; pass back as ListOptions.cursor. */
  cursor?: string;
}

export interface DriverCapabilities {
  /** Can issue signed, time-limited URLs (temporaryUrl). */
  presign: boolean;
  /** Supports native server-side multipart assembly (e.g. S3 multipart). */
  multipart: boolean;
  /** Can serve stable public URLs (url). */
  publicUrls: boolean;
  /** Can enumerate keys under a prefix (list). */
  list: boolean;
}

export interface MultipartPart {
  partNumber: number;
  etag: string;
}

/** Optional add-on surface for drivers that support native multipart presign (S3). Gated by capabilities.multipart. */
export interface MultipartUploadDriver {
  createMultipartUpload(path: string, options?: PutOptions): Promise<{ uploadId: string }>;
  /** Upload one part's bytes server-side (proxy path). Returns the part's ETag. */
  uploadPart(
    path: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<MultipartPart>;
  presignUploadPart(
    path: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number,
  ): Promise<string>;
  completeMultipartUpload(path: string, uploadId: string, parts: MultipartPart[]): Promise<void>;
  abortMultipartUpload(path: string, uploadId: string): Promise<void>;
}

export interface StatResult {
  size: number;
  contentType?: string;
  lastModified?: Date;
}

export interface StorageDriver {
  readonly capabilities: DriverCapabilities;
  put(path: string, contents: Buffer | Readable, options?: PutOptions): Promise<void>;
  get(path: string): Promise<Buffer>;
  stream(path: string): Promise<Readable>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  size(path: string): Promise<number>;
  /** Object metadata (size/content-type/last-modified) without downloading the body.
   *  Optional; all bundled drivers implement it. */
  stat?(path: string): Promise<StatResult>;
  /** Delete many objects in one call. Optional; all bundled drivers implement it.
   *  An empty array is a no-op. */
  deleteMany?(paths: string[]): Promise<void>;
  url(path: string): Promise<string>;
  temporaryUrl(path: string, expiresInSeconds: number): Promise<string>;
  list(prefix: string, options?: ListOptions): Promise<ListResult>;
}
