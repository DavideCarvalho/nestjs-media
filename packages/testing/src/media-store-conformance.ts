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

    it('list paginates by (createdAt, id) with a round-trip cursor', async () => {
      const store = await makeStore();
      if (typeof store.list !== 'function') return;
      // Distinct createdAt so ordering is by date; ids intentionally out of insert order.
      await store.save(makeRecord({ id: 'c', collection: 'gallery', createdAt: new Date(3000) }));
      await store.save(makeRecord({ id: 'a', collection: 'gallery', createdAt: new Date(1000) }));
      await store.save(makeRecord({ id: 'b', collection: 'gallery', createdAt: new Date(2000) }));
      await store.save(makeRecord({ id: 'd', collection: 'avatar', createdAt: new Date(4000) }));

      const page1 = await store.list({ collection: 'gallery' }, { limit: 2 });
      expect(page1.records.map((r) => r.id)).toEqual(['a', 'b']);
      const cursor = page1.cursor;
      if (cursor === undefined) throw new Error('expected a cursor after the first page');

      const page2 = await store.list({ collection: 'gallery' }, { limit: 2, cursor });
      expect(page2.records.map((r) => r.id)).toEqual(['c']);
      expect(page2.cursor).toBeUndefined();
    });

    it('list filters by disk and returns everything unfiltered', async () => {
      const store = await makeStore();
      if (typeof store.list !== 'function') return;
      await store.save(makeRecord({ id: 'a', disk: 'local', createdAt: new Date(1000) }));
      await store.save(makeRecord({ id: 'b', disk: 's3', createdAt: new Date(2000) }));
      await store.save(makeRecord({ id: 'c', disk: 'local', createdAt: new Date(3000) }));

      const onLocal = await store.list({ disk: 'local' }, { limit: 50 });
      expect(onLocal.records.map((r) => r.id)).toEqual(['a', 'c']);

      const everything = await store.list({}, { limit: 50 });
      expect(everything.records).toHaveLength(3);
      expect(everything.cursor).toBeUndefined();
    });

    it('list ignores a malformed cursor instead of throwing', async () => {
      const store = await makeStore();
      if (typeof store.list !== 'function') return;
      await store.save(makeRecord({ id: 'a', createdAt: new Date(1000) }));
      // A garbage cursor (no separator / not our encoding) must be treated as "no cursor" and
      // list from the start, never surface a DB error.
      const result = await store.list({}, { limit: 10, cursor: 'not-a-valid-cursor' });
      expect(result.records.map((r) => r.id)).toEqual(['a']);
    });

    it("save returns the tenantId that was persisted, never one it didn't store", async () => {
      const store = await makeStore();
      // Off: a store that doesn't keep `tenantId` must not echo it back.
      const off = await store.save(makeRecord({ id: 'off', tenantId: 'not-stored' }));
      expect(off.tenantId ?? null).toEqual((await store.find('off'))?.tenantId ?? null);
      if (typeof store.enableTenancy !== 'function') return;
      await store.enableTenancy();
      const on = await store.save(makeRecord({ id: 'on', tenantId: 't1' }));
      expect(on.tenantId).toBe('t1');
      expect((await store.find('on'))?.tenantId).toBe('t1');
    });

    it('with tenancy enabled, persists tenantId and honours tenant filters', async () => {
      const store = await makeStore();
      if (typeof store.enableTenancy !== 'function') return;
      await store.enableTenancy();
      await store.save(makeRecord({ id: 'a', tenantId: 't1', createdAt: new Date(1000), size: 1 }));
      await store.save(makeRecord({ id: 'b', tenantId: 't2', createdAt: new Date(2000), size: 2 }));
      await store.save(makeRecord({ id: 'c', tenantId: null, createdAt: new Date(3000), size: 4 }));
      await store.save(makeRecord({ id: 'd', tenantId: 't1', createdAt: new Date(4000), size: 8 }));

      expect((await store.find('a'))?.tenantId).toBe('t1');
      expect((await store.find('c'))?.tenantId ?? null).toBeNull();
      const byOwner = await store.listByOwner('Post', '1');
      expect(Object.fromEntries(byOwner.map((r) => [r.id, r.tenantId ?? null]))).toEqual({
        a: 't1',
        b: 't2',
        c: null,
        d: 't1',
      });

      // An upsert can move a record to another tenant.
      const moved = await store.find('d');
      if (!moved) throw new Error('expected record d');
      await store.save({ ...moved, tenantId: 't2' });
      expect((await store.find('d'))?.tenantId).toBe('t2');
      await store.save({ ...moved, tenantId: 't1' });

      if (typeof store.count === 'function') {
        expect(await store.count({ tenant: { id: 't1' } })).toBe(2);
        expect(await store.count({ tenant: { id: null } })).toBe(1);
        expect(await store.count({ tenant: { id: 't1', orNull: true } })).toBe(3);
        expect(await store.count()).toBe(4);
      }
      if (typeof store.aggregate === 'function') {
        const buckets = await store.aggregate({
          groupBy: 'collection',
          sum: 'size',
          tenant: { id: 't1' },
        });
        expect(buckets).toEqual([{ key: 'gallery', count: 2, sumSize: 9 }]);
      }
      if (typeof store.list === 'function') {
        const t1 = await store.list({ tenant: { id: 't1' } }, { limit: 50 });
        expect(t1.records.map((r) => [r.id, r.tenantId])).toEqual([
          ['a', 't1'],
          ['d', 't1'],
        ]);
        const none = await store.list({ tenant: { id: null } }, { limit: 50 });
        expect(none.records.map((r) => r.id)).toEqual(['c']);
        const shared = await store.list({ tenant: { id: 't2', orNull: true } }, { limit: 1 });
        expect(shared.records.map((r) => r.id)).toEqual(['b']);
        const next = await store.list(
          { tenant: { id: 't2', orNull: true } },
          { limit: 1, ...(shared.cursor ? { cursor: shared.cursor } : {}) },
        );
        expect(next.records.map((r) => r.id)).toEqual(['c']);
      }
    });
  });
}
