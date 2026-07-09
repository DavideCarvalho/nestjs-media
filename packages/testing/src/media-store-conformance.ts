import type { MediaRecord, MediaStore } from '@dudousxd/nestjs-media-core';
import { describe, expect, it } from 'vitest';

let seq = 0;
function makeRecord(over: Partial<MediaRecord> = {}): MediaRecord {
  seq += 1;
  const ts = new Date(0);
  return {
    id: `id-${seq}`,
    ownerType: 'Post',
    ownerId: '1',
    collection: 'gallery',
    name: 'file',
    fileName: 'file.txt',
    mimeType: 'text/plain',
    size: 4,
    disk: 'local',
    path: 'p',
    order: 0,
    customProperties: {},
    conversions: {},
    createdAt: ts,
    updatedAt: ts,
    ...over,
  };
}

/** Shared behavioral contract every MediaStore implementation must satisfy. */
export function runMediaStoreConformance(
  name: string,
  makeStore: () => MediaStore | Promise<MediaStore>,
): void {
  describe(`MediaStore conformance: ${name}`, () => {
    it('saves and finds a record by id', async () => {
      const store = await makeStore();
      const saved = await store.save(makeRecord({ id: 'a' }));
      expect(saved.id).toBe('a');
      expect((await store.find('a'))?.id).toBe('a');
    });

    it('find returns null for an unknown id', async () => {
      const store = await makeStore();
      expect(await store.find('nope')).toBeNull();
    });

    it('lists by owner, filtered by collection, ordered by order', async () => {
      const store = await makeStore();
      await store.save(makeRecord({ id: 'a', collection: 'gallery', order: 1 }));
      await store.save(makeRecord({ id: 'b', collection: 'gallery', order: 0 }));
      await store.save(makeRecord({ id: 'c', collection: 'avatar', order: 0 }));

      const gallery = await store.listByOwner('Post', '1', 'gallery');
      expect(gallery.map((r) => r.id)).toEqual(['b', 'a']);

      const all = await store.listByOwner('Post', '1');
      expect(all).toHaveLength(3);
    });

    it('nextOrder grows with the collection', async () => {
      const store = await makeStore();
      expect(await store.nextOrder('Post', '1', 'gallery')).toBe(0);
      await store.save(makeRecord({ id: 'a', order: 0 }));
      await store.save(makeRecord({ id: 'b', order: 1 }));
      expect(await store.nextOrder('Post', '1', 'gallery')).toBe(2);
    });

    it('deletes a record', async () => {
      const store = await makeStore();
      await store.save(makeRecord({ id: 'a' }));
      await store.delete('a');
      expect(await store.find('a')).toBeNull();
    });

    it('count returns the global total, and honours filters', async () => {
      const store = await makeStore();
      if (typeof store.count !== 'function') return;
      await store.save(makeRecord({ id: 'a', collection: 'gallery', disk: 'local', size: 3 }));
      await store.save(makeRecord({ id: 'b', collection: 'gallery', disk: 's3', size: 5 }));
      await store.save(makeRecord({ id: 'c', collection: 'avatar', disk: 'local', size: 7 }));
      expect(await store.count()).toBe(3);
      expect(await store.count({ collection: 'gallery' })).toBe(2);
      expect(await store.count({ disk: 'local' })).toBe(2);
      expect(await store.count({ collection: 'gallery', disk: 's3' })).toBe(1);
    });

    it('aggregate groups by collection/disk with counts and summed sizes', async () => {
      const store = await makeStore();
      if (typeof store.aggregate !== 'function') return;
      await store.save(makeRecord({ id: 'a', collection: 'gallery', disk: 'local', size: 3 }));
      await store.save(makeRecord({ id: 'b', collection: 'gallery', disk: 's3', size: 5 }));
      await store.save(makeRecord({ id: 'c', collection: 'avatar', disk: 'local', size: 7 }));

      const byCollection = await store.aggregate({ groupBy: 'collection', sum: 'size' });
      const collectionMap = new Map(byCollection.map((b) => [b.key, b]));
      expect(collectionMap.get('gallery')).toEqual({ key: 'gallery', count: 2, sumSize: 8 });
      expect(collectionMap.get('avatar')).toEqual({ key: 'avatar', count: 1, sumSize: 7 });

      const byDisk = await store.aggregate({ groupBy: 'disk', sum: 'size' });
      const diskMap = new Map(byDisk.map((b) => [b.key, b]));
      expect(diskMap.get('local')).toEqual({ key: 'local', count: 2, sumSize: 10 });
      expect(diskMap.get('s3')).toEqual({ key: 's3', count: 1, sumSize: 5 });
    });
  });
}
