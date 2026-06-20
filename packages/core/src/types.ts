import type { Readable } from 'node:stream';

export type Visibility = 'public' | 'private';

export interface PutOptions {
  contentType?: string;
  visibility?: Visibility;
  metadata?: Record<string, string>;
}

export interface DriverCapabilities {
  /** Can issue signed, time-limited URLs (temporaryUrl). */
  presign: boolean;
  /** Supports native server-side multipart assembly (e.g. S3 multipart). */
  multipart: boolean;
  /** Can serve stable public URLs (url). */
  publicUrls: boolean;
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
  url(path: string): Promise<string>;
  temporaryUrl(path: string, expiresInSeconds: number): Promise<string>;
}
