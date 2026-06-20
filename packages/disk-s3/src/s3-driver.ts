import type { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  type DriverCapabilities,
  FileNotFoundError,
  type PutOptions,
  type StorageDriver,
  UnsupportedOperationError,
} from '@dudousxd/nestjs-media-core';

export interface S3DriverOptions {
  client: S3Client;
  bucket: string;
  /** Prefix prepended to every key (e.g. `uploads`). */
  keyPrefix?: string;
  /** Base URL for stable public URLs (CDN or bucket website). Enables `url()`. */
  publicBaseUrl?: string;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

export class S3Driver implements StorageDriver {
  readonly capabilities: DriverCapabilities;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly publicBaseUrl: string | undefined;

  constructor(options: S3DriverOptions) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.keyPrefix = (options.keyPrefix ?? '').replace(/^\/+|\/+$/g, '');
    this.publicBaseUrl = options.publicBaseUrl;
    this.capabilities = { presign: true, multipart: true, publicUrls: !!options.publicBaseUrl };
  }

  /** Map a logical path to a fully-qualified S3 key. */
  key(path: string): string {
    const clean = path.replace(/^\/+/, '');
    return this.keyPrefix ? `${this.keyPrefix}/${clean}` : clean;
  }

  async put(path: string, contents: Buffer | Readable, options?: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(path),
        Body: contents,
        ContentType: options?.contentType,
        Metadata: options?.metadata,
        ACL: options?.visibility === 'public' ? 'public-read' : undefined,
      }),
    );
  }

  async get(path: string): Promise<Buffer> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      );
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new FileNotFoundError(path);
      return Buffer.from(bytes);
    } catch (err) {
      if (isNotFound(err)) throw new FileNotFoundError(path);
      throw err;
    }
  }

  async stream(path: string): Promise<Readable> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      );
      if (!res.Body) throw new FileNotFoundError(path);
      return res.Body as Readable;
    } catch (err) {
      if (isNotFound(err)) throw new FileNotFoundError(path);
      throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(path) }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async size(path: string): Promise<number> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      );
      return res.ContentLength ?? 0;
    } catch (err) {
      if (isNotFound(err)) throw new FileNotFoundError(path);
      throw err;
    }
  }

  async delete(path: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(path) }));
  }

  async copy(from: string, to: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${this.key(from)}`,
        Key: this.key(to),
      }),
    );
  }

  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    await this.delete(from);
  }

  async url(path: string): Promise<string> {
    if (!this.publicBaseUrl) throw new UnsupportedOperationError('s3', 'url');
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${this.key(path)}`;
  }

  async temporaryUrl(path: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      { expiresIn: expiresInSeconds },
    );
  }
}
