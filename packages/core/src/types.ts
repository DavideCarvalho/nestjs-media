import type { StorageDisk, StorageListEntry } from '@nestjs/storage';

/**
 * The disks the media layer writes to: `Storage` from `@nestjs/storage` satisfies it as it is.
 * A plain object works too (tests, a hand-built set of disks).
 */
export interface MediaDisks {
  /** The disk used when nothing names one. */
  readonly defaultDisk: string;
  /** The disk called `name`, or the default one. Throws for a name that isn't configured. */
  disk(name?: string): StorageDisk;
  names(): string[];
}

export interface MultipartPart {
  partNumber: number;
  etag: string;
}

/** Options a multipart upload is created with (stored on the assembled object). */
export interface MultipartCreateOptions {
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

/**
 * Native multipart uploads for one disk, which `StorageDisk` keeps private (S3Disk splits large
 * bodies itself, but exposes no part-level API). A side-car that addresses the same objects as
 * the disk: the key passed here is the disk's key, and the side-car applies the disk's prefix.
 * Configured per disk name (`MediaModule.forRoot({ multipart: { s3: s3Multipart({...}) } })`).
 */
export interface MultipartUploadDriver {
  createMultipartUpload(
    key: string,
    options?: MultipartCreateOptions,
  ): Promise<{ uploadId: string }>;
  /** Upload one part's bytes server-side (proxy path). Returns the part's ETag. */
  uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<MultipartPart>;
  /** A presigned `PUT` URL for one part (direct path). */
  presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number,
  ): Promise<string>;
  completeMultipartUpload(key: string, uploadId: string, parts: MultipartPart[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  /** Optional: delimiter listing (see {@link FolderListing}). */
  listFolders?(
    prefix: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<FolderListing>;
}

/**
 * One level of a disk, as an S3 `ListObjectsV2` with `Delimiter: '/'` returns it. `StorageDisk`
 * lists flat only; a side-car that can ask the store for folders implements
 * `MultipartUploadDriver.listFolders`, and consumers fold a flat listing otherwise.
 */
export interface FolderListing {
  /** Sub-folder prefixes directly under the prefix, each ending in `/`. */
  folders: string[];
  /** Files directly under the prefix. */
  files: StorageListEntry[];
  /** Present when there are more; pass it back. */
  cursor?: string;
}

/**
 * What a disk can do, as the dashboard and telescope show it. Computed by
 * {@link diskCapabilities} from the disk and its multipart side-car, not declared by the disk.
 */
export interface MediaDiskCapabilities {
  /** `signedUrl()` works: S3, or a local/in-memory disk with `signedUrls`. */
  presign: boolean;
  /** A multipart side-car is configured for the disk. */
  multipart: boolean;
  /** `url()` works (the disk has a `publicUrl`). */
  publicUrls: boolean;
  /** Always `true`: every `StorageDisk` lists. */
  list: boolean;
  /** Always `true`: every `StorageDisk` reads byte ranges. */
  ranged: boolean;
}
