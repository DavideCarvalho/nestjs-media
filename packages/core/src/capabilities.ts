import type { StorageDisk } from '@nestjs/storage';
import type { MediaDiskCapabilities, MultipartUploadDriver } from './types';

const PROBE_KEY = 'media-capability-probe';
const presignCache = new WeakMap<StorageDisk, Promise<boolean>>();

/** Whether `url()` works: it throws a `StorageError` when the disk has no `publicUrl`. */
export function hasPublicUrl(disk: StorageDisk): boolean {
  try {
    disk.url(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `signedUrl()` works: always on S3, and on a local or in-memory disk configured with
 * `signedUrls`. Signing is local (HMAC or SigV4, no request), so this asks the disk to sign a
 * probe key once and remembers the answer.
 */
export function canPresign(disk: StorageDisk): Promise<boolean> {
  let cached = presignCache.get(disk);
  if (!cached) {
    cached = disk.signedUrl(PROBE_KEY, { expiresIn: '1m' }).then(
      () => true,
      () => false,
    );
    presignCache.set(disk, cached);
  }
  return cached;
}

/** The capability badges for a disk and its (optional) multipart side-car. */
export async function diskCapabilities(
  disk: StorageDisk,
  multipart?: MultipartUploadDriver,
): Promise<MediaDiskCapabilities> {
  return {
    presign: await canPresign(disk),
    multipart: multipart !== undefined,
    publicUrls: hasPublicUrl(disk),
    list: true,
    ranged: true,
  };
}
