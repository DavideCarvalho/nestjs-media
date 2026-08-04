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
  /**
   * Can serve a byte range of an object without transferring the whole thing
   * (`stream(path, range)`).
   *
   * Required rather than optional ON PURPOSE. A third-party driver that silently ignored the
   * `range` argument would hand back the entire object where the caller asked for a slice — a
   * reader paging 4 KB out of a 400 MB database would pull all 400 MB and never notice it was
   * "working". Making the field required turns that into a compile error the driver author has to
   * answer, which is the only point at which anyone can answer it.
   */
  ranged: boolean;
}

/**
 * A byte range to read out of an object, in HTTP `Range` semantics (both bounds inclusive) so it
 * maps 1:1 onto the header it usually comes from and onto S3's `Range` / Node's `createReadStream`.
 */
export interface ReadRangeOptions {
  /** First byte to read, inclusive. */
  start: number;
  /** Last byte to read, INCLUSIVE (HTTP `Range` semantics). Omit to read to EOF. */
  end?: number;
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

export interface TemporaryUrlOptions {
  /** Overrides the `Content-Type` the response is served with (S3 `response-content-type`). */
  responseContentType?: string;
  /** Overrides the `Content-Disposition` the response is served with
   *  (S3 `response-content-disposition`), e.g. to force a download filename. */
  responseContentDisposition?: string;
}

export interface StorageDriver {
  readonly capabilities: DriverCapabilities;
  put(path: string, contents: Buffer | Readable, options?: PutOptions): Promise<void>;
  get(path: string): Promise<Buffer>;
  /** The object's bytes as a stream. With `range`, only that slice — gated by
   *  {@link DriverCapabilities.ranged}; a driver that advertises `ranged: false` may ignore it. */
  stream(path: string, range?: ReadRangeOptions): Promise<Readable>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  size(path: string): Promise<number>;
  /** Object metadata (size/content-type/last-modified) without downloading the body. */
  stat(path: string): Promise<StatResult>;
  /** Delete many objects in one call. Optional; all bundled drivers implement it.
   *  An empty array is a no-op. */
  deleteMany?(paths: string[]): Promise<void>;
  url(path: string): Promise<string>;
  temporaryUrl(
    path: string,
    expiresInSeconds: number,
    options?: TemporaryUrlOptions,
  ): Promise<string>;
  list(prefix: string, options?: ListOptions): Promise<ListResult>;
}
