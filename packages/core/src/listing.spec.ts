import { InMemoryDisk } from '@nestjs/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FOLDER_LISTING_LIMIT,
  MAX_FOLDER_LISTING_LIMIT,
  foldListing,
  folderListingLimit,
  listFolderLevel,
} from './listing';
import type { FolderListing, MultipartUploadDriver } from './types';

/** A disk with `n` files directly under `docs/`. */
async function diskWith(n: number): Promise<InMemoryDisk> {
  const disk = new InMemoryDisk();
  for (let i = 0; i < n; i += 1) {
    await disk.put(`docs/f${String(i).padStart(5, '0')}.txt`, 'x');
  }
  return disk;
}

/** A side-car whose `listFolders` records the options it is given. */
function sidecar(): {
  driver: MultipartUploadDriver;
  calls: Array<{ cursor?: string; limit?: number } | undefined>;
} {
  const calls: Array<{ cursor?: string; limit?: number } | undefined> = [];
  const driver = {
    listFolders: vi.fn(async (_prefix: string, options?: { cursor?: string; limit?: number }) => {
      calls.push(options);
      return { folders: [], files: [] } satisfies FolderListing;
    }),
  } as unknown as MultipartUploadDriver;
  return { driver, calls };
}

describe('folder listing page size', () => {
  it('is 50 by default and capped at 1000', () => {
    expect(DEFAULT_FOLDER_LISTING_LIMIT).toBe(50);
    expect(MAX_FOLDER_LISTING_LIMIT).toBe(1000);
    expect(folderListingLimit(undefined)).toBe(50);
    expect(folderListingLimit(7)).toBe(7);
    expect(folderListingLimit(5000)).toBe(1000);
  });

  it('rejects a limit that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => folderListingLimit(bad)).toThrow(RangeError);
    }
  });

  it('flat fold: 50 entries per page by default, `limit` when given, 1000 at most', async () => {
    const disk = await diskWith(1100);
    const first = await listFolderLevel(disk, 'docs/');
    expect(first.files).toHaveLength(50);
    expect(first.cursor).toBeDefined();

    expect((await listFolderLevel(disk, 'docs/', { limit: 7 })).files).toHaveLength(7);
    expect((await listFolderLevel(disk, 'docs/', { limit: 5000 })).files).toHaveLength(1000);
    // foldListing on its own: the same default.
    expect((await foldListing(disk, 'docs/')).files).toHaveLength(50);
  });

  it('side-car: gets the same page size (default, given, capped)', async () => {
    const disk = new InMemoryDisk();
    const { driver, calls } = sidecar();
    await listFolderLevel(disk, 'docs/', {}, driver);
    await listFolderLevel(disk, 'docs/', { limit: 7, cursor: 'c1' }, driver);
    await listFolderLevel(disk, 'docs/', { limit: 5000 }, driver);
    expect(calls).toEqual([{ limit: 50 }, { cursor: 'c1', limit: 7 }, { limit: 1000 }]);
  });

  it('a bad limit fails on both paths before anything is listed', async () => {
    const disk = new InMemoryDisk();
    const { driver, calls } = sidecar();
    await expect(listFolderLevel(disk, 'docs/', { limit: 0 }, driver)).rejects.toThrow(RangeError);
    await expect(foldListing(disk, 'docs/', { limit: 0 })).rejects.toThrow(RangeError);
    expect(calls).toEqual([]);
  });
});
