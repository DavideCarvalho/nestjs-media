import type { MediaRecord } from '@dudousxd/nestjs-media-core';
import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { describe, expect, it } from 'vitest';
import type { PrismaClientLike, PrismaMediaDelegate } from './prisma-media-store';
import { PrismaMediaStore } from './prisma-media-store';

/** Minimal in-memory fake mirroring the Prisma delegate semantics the store relies on. */
function fakeClient(): PrismaClientLike & { rows: Map<string, MediaRecord> } {
  const rows = new Map<string, MediaRecord>();
  const media: PrismaMediaDelegate = {
    async upsert({ where, create, update }) {
      rows.set(where.id, rows.has(where.id) ? { ...update } : { ...create });
      return rows.get(where.id);
    },
    async findUnique({ where }) {
      return rows.get(where.id) ?? null;
    },
    async findMany({ where, orderBy }) {
      const list = [...rows.values()].filter(
        (r) =>
          r.ownerType === where.ownerType &&
          r.ownerId === where.ownerId &&
          (where.collection === undefined || r.collection === where.collection),
      );
      list.sort((a, b) => (orderBy.order === 'asc' ? a.order - b.order : b.order - a.order));
      return list;
    },
    async deleteMany({ where }) {
      rows.delete(where.id);
      return { count: 1 };
    },
    async aggregate({ where }) {
      const list = [...rows.values()].filter(
        (r) =>
          r.ownerType === where.ownerType &&
          r.ownerId === where.ownerId &&
          r.collection === where.collection,
      );
      const order = list.length ? Math.max(...list.map((r) => r.order)) : null;
      return { _max: { order } };
    },
    async count({ where }) {
      return [...rows.values()].filter(
        (r) =>
          (where?.ownerType === undefined || r.ownerType === where.ownerType) &&
          (where?.collection === undefined || r.collection === where.collection) &&
          (where?.disk === undefined || r.disk === where.disk),
      ).length;
    },
    async groupBy({ by }) {
      const groups = new Map<string, MediaRecord[]>();
      for (const r of rows.values()) {
        const key = String(r[by[0]]);
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      return [...groups.entries()].map(([key, list]) => ({
        [by[0]]: key,
        _count: list.length,
        _sum: { size: list.reduce((sum, r) => sum + r.size, 0) },
      }));
    },
  };
  return { media, rows };
}

runMediaStoreConformance(
  'PrismaMediaStore (fake delegate)',
  () => new PrismaMediaStore(fakeClient()),
);

describe('PrismaMediaStore', () => {
  it('upserts through the delegate and reads back', async () => {
    const client = fakeClient();
    const store = new PrismaMediaStore(client);
    await store.save({
      id: 'a',
      ownerType: 'Post',
      ownerId: '1',
      collection: 'gallery',
      name: 'n',
      fileName: 'n.png',
      mimeType: 'image/png',
      size: 1,
      disk: 'local',
      path: 'p',
      order: 0,
      customProperties: {},
      conversions: {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    expect(client.rows.get('a')?.id).toBe('a');
    expect((await store.find('a'))?.id).toBe('a');
  });
});
