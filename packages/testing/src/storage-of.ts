import { Storage, type StorageDisk } from '@nestjs/storage';

/**
 * A `Storage` (the `@nestjs/storage` service) over the given disks, for unit tests that build
 * `MediaLibrary`/`AttachmentManager`/upload managers by hand instead of booting `StorageModule`:
 *
 * ```ts
 * const storage = storageOf({ local: new InMemoryDisk() });
 * const library = new MediaLibrary({ storage, store: new InMemoryMediaStore() });
 * ```
 *
 * The default disk is `defaultDisk`, else the first one.
 */
export function storageOf(disks: Record<string, StorageDisk>, defaultDisk?: string): Storage {
  const names = Object.keys(disks);
  const fallback = defaultDisk ?? names[0];
  if (fallback === undefined) throw new Error('storageOf() needs at least one disk');
  return new Storage(new Map(Object.entries(disks)), fallback);
}
