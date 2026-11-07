import { isIP } from 'node:net';
import {
  type FolderListing,
  type MultipartCreateOptions,
  type MultipartPart,
  type MultipartUploadDriver,
  assertMediaKey,
  folderListingLimit,
  folderPrefix,
} from '@dudousxd/nestjs-media-core';
import type { S3DiskOptions, StorageListEntry } from '@nestjs/storage';
import {
  EMPTY_SHA256,
  type SigV4Credentials,
  encodeKeyPath,
  encodeRfc3986,
  presignUrl,
  sha256Hex,
  signRequest,
} from './sigv4';
import { encodeXml, xmlElements, xmlText } from './xml';

/**
 * The options of the `S3Disk` the side-car serves: pass the very same object to both, so keys,
 * prefix, endpoint and addressing style line up by construction. Options only `S3Disk` uses
 * (retries, timeouts, part size, public URL) are ignored here.
 */
export type S3MultipartOptions = S3DiskOptions;

/** An S3 request that failed. `code` is S3's (`NoSuchUpload`, `AccessDenied`, …) or `NetworkError`. */
export class S3MultipartError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string,
    readonly upstreamStatus: number | undefined,
    message?: string,
  ) {
    super(`S3 ${operation} failed: ${code}${message ? ` (${message})` : ''}`);
    this.name = 'S3MultipartError';
  }
}

/** The side-car `s3Multipart()` returns: native multipart uploads plus delimiter listing. */
export interface S3Multipart extends MultipartUploadDriver {
  listFolders(
    prefix: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<FolderListing>;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * The part-level S3 API that `@nestjs/storage`'s `S3Disk` keeps private (it uses multipart
 * itself, automatically, for large `put()`s), for nestjs-media's resumable and direct uploads,
 * plus `ListObjectsV2` with a delimiter for the dashboard's folders:
 *
 * ```ts
 * const s3 = { bucket: 'media', region: 'auto', endpoint: process.env.R2_ENDPOINT };
 * StorageModule.forRoot({ disks: { s3: new S3Disk(s3) } });
 * MediaModule.forRoot({ multipart: { s3: s3Multipart(s3) }, ... });
 * ```
 *
 * Over `fetch` with Signature Version 4 on `node:crypto`, like `S3Disk`: no AWS SDK.
 */
export function s3Multipart(options: S3MultipartOptions): S3Multipart {
  return new S3MultipartDriver(options);
}

class S3MultipartDriver implements S3Multipart {
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: URL;
  private readonly pathStyle: boolean;
  private readonly prefix: string;
  private readonly credentials: () => Promise<SigV4Credentials>;
  private readonly encryption: Record<string, string>;
  private readonly fetchFn: typeof fetch;

  constructor(options: S3MultipartOptions) {
    this.bucket = options.bucket;
    this.region =
      options.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
    this.endpoint = new URL(options.endpoint ?? `https://s3.${this.region}.amazonaws.com`);
    // The same rule as S3Disk, so both address the bucket the same way.
    const hostIsIp = isIP(this.endpoint.hostname.replace(/^\[|\]$/g, '')) !== 0;
    const dnsCompatible =
      /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(this.bucket) ||
      (this.endpoint.protocol === 'http:' &&
        /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(this.bucket) &&
        !this.bucket.includes('..'));
    this.pathStyle = options.forcePathStyle === true || hostIsIp || !dnsCompatible;
    this.prefix = options.prefix ?? '';
    const credentials = options.credentials;
    this.credentials = async () => {
      const resolved =
        typeof credentials === 'function'
          ? await credentials()
          : (credentials ?? fromEnvironment());
      return resolved;
    };
    this.encryption = {
      ...(options.serverSideEncryption
        ? { 'x-amz-server-side-encryption': options.serverSideEncryption }
        : {}),
      ...(options.kmsKeyId
        ? { 'x-amz-server-side-encryption-aws-kms-key-id': options.kmsKeyId }
        : {}),
    };
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  async createMultipartUpload(
    key: string,
    options: MultipartCreateOptions = {},
  ): Promise<{ uploadId: string }> {
    assertMediaKey(key);
    const headers: Record<string, string> = {
      ...this.encryption,
      'content-type': options.contentType ?? 'application/octet-stream',
      ...(options.cacheControl ? { 'cache-control': options.cacheControl } : {}),
    };
    for (const [name, value] of Object.entries(options.metadata ?? {})) {
      headers[`x-amz-meta-${name.toLowerCase()}`] = value;
    }
    const res = await this.send('CreateMultipartUpload', 'POST', key, [['uploads', '']], headers);
    const uploadId = xmlText(await res.text(), 'UploadId');
    if (!uploadId) throw new S3MultipartError('CreateMultipartUpload', 'NoUploadId', res.status);
    return { uploadId };
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<MultipartPart> {
    assertMediaKey(key);
    const res = await this.send(
      'UploadPart',
      'PUT',
      key,
      [
        ['partNumber', String(partNumber)],
        ['uploadId', uploadId],
      ],
      {},
      body,
    );
    await res.arrayBuffer();
    const etag = res.headers.get('etag');
    if (!etag) throw new S3MultipartError('UploadPart', 'NoETag', res.status);
    return { partNumber, etag };
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number,
  ): Promise<string> {
    assertMediaKey(key);
    const url = this.url(this.prefix + key, [
      ['partNumber', String(partNumber)],
      ['uploadId', uploadId],
    ]);
    return presignUrl({
      method: 'PUT',
      url,
      expiresInSeconds,
      credentials: await this.credentials(),
      region: this.region,
      date: new Date(),
    }).toString();
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<void> {
    assertMediaKey(key);
    const body = Buffer.from(
      `<CompleteMultipartUpload>${parts
        .map(
          (part) =>
            `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${encodeXml(part.etag)}</ETag></Part>`,
        )
        .join('')}</CompleteMultipartUpload>`,
    );
    const res = await this.send(
      'CompleteMultipartUpload',
      'POST',
      key,
      [['uploadId', uploadId]],
      { 'content-type': 'application/xml' },
      body,
    );
    // S3 can answer 200 with an <Error> body when the assembly fails late.
    const text = await res.text();
    if (text.includes('<Error>')) {
      throw new S3MultipartError(
        'CompleteMultipartUpload',
        xmlText(text, 'Code') ?? 'Error',
        res.status,
        xmlText(text, 'Message'),
      );
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    assertMediaKey(key);
    try {
      const res = await this.send('AbortMultipartUpload', 'DELETE', key, [['uploadId', uploadId]]);
      await res.arrayBuffer();
    } catch (error) {
      // Already completed or aborted: nothing left to abort.
      if (error instanceof S3MultipartError && error.code === 'NoSuchUpload') return;
      throw error;
    }
  }

  async listFolders(
    prefix: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<FolderListing> {
    const normalized = folderPrefix(prefix);
    const full = this.prefix + normalized;
    const query: Array<[string, string]> = [
      ['list-type', '2'],
      ['delimiter', '/'],
      // Same page size as the folded listing: default 50, at most 1000 (S3's own cap).
      ['max-keys', String(folderListingLimit(options.limit))],
      ...(full ? ([['prefix', full]] as Array<[string, string]>) : []),
      ...(options.cursor
        ? ([['continuation-token', options.cursor]] as Array<[string, string]>)
        : []),
    ];
    const res = await this.send('ListObjectsV2', 'GET', undefined, query);
    const xml = await res.text();
    const strip = (key: string) => key.slice(this.prefix.length);
    const folders = xmlElements(xml, 'CommonPrefixes')
      .map((block) => xmlText(block, 'Prefix'))
      .filter((value): value is string => value?.startsWith(this.prefix) === true)
      .map(strip)
      // A run of slashes (`a//`) is no folder a StorageDisk could list into.
      .filter((folder) => folder.slice(normalized.length) !== '/');
    const files: StorageListEntry[] = [];
    for (const block of xmlElements(xml, 'Contents')) {
      const fullKey = xmlText(block, 'Key');
      if (fullKey === undefined || !fullKey.startsWith(this.prefix)) continue;
      const key = strip(fullKey);
      // The `prefix/` marker object some tools write is the folder itself, not a file in it.
      if (key === normalized) continue;
      const etag = xmlText(block, 'ETag');
      files.push({
        key,
        size: Number(xmlText(block, 'Size') ?? 0),
        lastModified: new Date(xmlText(block, 'LastModified') ?? 0),
        ...(etag ? { etag } : {}),
      });
    }
    const truncated = xmlText(xml, 'IsTruncated') === 'true';
    const next = xmlText(xml, 'NextContinuationToken');
    return { folders, files, ...(truncated && next ? { cursor: next } : {}) };
  }

  private url(fullKey: string | undefined, query: Array<[string, string]>): URL {
    const path = fullKey === undefined ? '' : encodeKeyPath(fullKey);
    const search = query.length
      ? `?${query.map(([n, v]) => `${encodeRfc3986(n)}=${encodeRfc3986(v)}`).join('&')}`
      : '';
    const host = this.pathStyle ? this.endpoint.host : `${this.bucket}.${this.endpoint.host}`;
    return new URL(
      `${this.endpoint.protocol}//${host}/${this.pathStyle ? `${this.bucket}/${path}` : path}${search}`,
    );
  }

  private async send(
    operation: string,
    method: string,
    key: string | undefined,
    query: Array<[string, string]>,
    headers: Record<string, string> = {},
    body?: Buffer,
  ): Promise<Response> {
    const url = this.url(key === undefined ? undefined : this.prefix + key, query);
    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
    for (let attempt = 1; ; attempt += 1) {
      const signed = signRequest({
        method,
        url,
        headers,
        payloadHash,
        credentials: await this.credentials(),
        region: this.region,
        date: new Date(),
      });
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method,
          headers: signed,
          ...(body ? { body: new Uint8Array(body) } : {}),
        });
      } catch (error) {
        if (attempt < 3) continue;
        throw new S3MultipartError(
          operation,
          'NetworkError',
          undefined,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (res.ok) return res;
      const text = await res.text().catch(() => '');
      if (RETRYABLE.has(res.status) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
        continue;
      }
      throw new S3MultipartError(
        operation,
        xmlText(text, 'Code') ?? `HTTP${res.status}`,
        res.status,
        xmlText(text, 'Message'),
      );
    }
  }
}

function fromEnvironment(): SigV4Credentials {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      's3Multipart: no `credentials` and no AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in the environment',
    );
  }
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  return { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
}
