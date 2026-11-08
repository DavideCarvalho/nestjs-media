import type { S3DiskOptions } from '@nestjs/storage';
import { EMPTY_SHA256, signRequest } from '../sigv4';

/** `PUT /bucket` on a path-style endpoint (MinIO), signed with the options' static credentials. */
export async function createBucket(options: S3DiskOptions): Promise<void> {
  const url = new URL(`${String(options.endpoint).replace(/\/$/, '')}/${options.bucket}`);
  const credentials = options.credentials as { accessKeyId: string; secretAccessKey: string };
  const headers = signRequest({
    method: 'PUT',
    url,
    payloadHash: EMPTY_SHA256,
    credentials,
    region: options.region ?? 'us-east-1',
    date: new Date(),
  });
  const res = await fetch(url, { method: 'PUT', headers });
  if (!res.ok && res.status !== 409)
    throw new Error(`CreateBucket: ${res.status} ${await res.text()}`);
}
