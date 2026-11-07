import type { StorageDisk, StorageSignedUrlRequest } from '@nestjs/storage';
import { hasPublicUrl } from './capabilities';
import type { MediaDisks } from './types';

/** The public URL when the disk has a `publicUrl`, else a signed one. */
export function fileUrl(
  disk: StorageDisk,
  path: string,
  options?: StorageSignedUrlRequest,
): Promise<string> {
  return hasPublicUrl(disk) ? Promise.resolve(disk.url(path)) : disk.signedUrl(path, options);
}

/** Deletes files on any number of disks: one `delete([...])` call per disk. */
export async function deleteKeys(
  storage: MediaDisks,
  files: ReadonlyArray<{ disk: string; path: string }>,
): Promise<void> {
  const byDisk = new Map<string, string[]>();
  for (const { disk, path } of files) byDisk.set(disk, [...(byDisk.get(disk) ?? []), path]);
  for (const [disk, paths] of byDisk) await storage.disk(disk).delete(paths);
}
