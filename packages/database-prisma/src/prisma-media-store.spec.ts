import type { MediaRecord } from '@dudousxd/nestjs-media-core';
import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { describe, expect, it } from 'vitest';
import type { PrismaClientLike, PrismaMediaDelegate } from './prisma-media-store';
import { PrismaMediaStore } from './prisma-media-store';

type TenantClause = { tenantId: string | null } | { OR: { tenantId: string | null }[] };

/** The tenant part of a `where` (`AND: [clause]` in lists/counts, the clause itself in groupBy). */
function matchesTenant(r: MediaRecord, clause: TenantClause | undefined): boolean {
  if (!clause) return true;
  const row = r.tenantId ?? null;
  if ('OR' in clause) return clause.OR.some((c) => c.tenantId === row);
  return clause.tenantId === row;
}

/**
 * Minimal in-memory fake mirroring the Prisma delegate semantics the store relies on.
 * `withTenantId: false` mimics a model without `tenantId` (Prisma rejects the unknown field).
 */
function fakeClient(
  options: { withTenantId?: boolean } = {},
): PrismaClientLike & { rows: Map<string, MediaRecord> } {
  const withTenantId = options.withTenantId ?? true;
  const rows = new Map<string, MediaRecord>();
  const media: PrismaMediaDelegate = {
    async upsert({ where, create, update }) {
      if (!withTenantId && ('tenantId' in create || 'tenantId' in update)) {
        throw new Error('Unknown argument `tenantId`');
      }
      const row = rows.has(where.id) ? { ...update } : { ...create };
      rows.set(where.id, row);
      return row;
    },
    async findUnique({ where }) {
      return rows.get(where.id) ?? null;
    },
    async findMany({ where, orderBy, take, select }) {
      if (select) {
        if (select.tenantId && !withTenantId) throw new Error('Unknown field `tenantId`');
        return [];
      }
      // `list()` orders by [{createdAt},{id}] (array); `listByOwner()` orders by a
      // single `{order}` field — branch on shape to mirror both call sites.
      if (Array.isArray(orderBy)) {
        type OrClause =
          | { createdAt: { getTime(): number }; id: { gt: string } }
          | { createdAt: { gt: { getTime(): number } } };
        const matchesCursor = (r: MediaRecord): boolean => {
          if (where.OR === undefined) return true;
          return (where.OR as OrClause[]).some((clause) =>
            'id' in clause
              ? r.createdAt.getTime() === clause.createdAt.getTime() && r.id > clause.id.gt
              : r.createdAt.getTime() > clause.createdAt.gt.getTime(),
          );
        };
        const list = [...rows.values()].filter(
          (r) =>
            (where.ownerType === undefined || r.ownerType === where.ownerType) &&
            (where.collection === undefined || r.collection === where.collection) &&
            (where.disk === undefined || r.disk === where.disk) &&
            matchesTenant(r, where.AND?.[0]) &&
            matchesCursor(r),
        );
        list.sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
        return take !== undefined ? list.slice(0, take) : list;
      }
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
          (where?.disk === undefined || r.disk === where.disk) &&
          matchesTenant(r, where?.AND?.[0]),
      ).length;
    },
    async groupBy({ by, where }: { by: (keyof MediaRecord)[]; where?: TenantClause }) {
      const groups = new Map<string, MediaRecord[]>();
      const [groupField] = by;
      if (!groupField) return [];
      for (const r of rows.values()) {
        if (!matchesTenant(r, where)) continue;
        const key = String(r[groupField]);
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      return [...groups.entries()].map(([key, list]) => ({
        [groupField]: key,
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

describe('PrismaMediaStore tenancy', () => {
  const record: MediaRecord = {
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
  };

  it('never writes tenantId until tenancy is enabled, so a model without it works', async () => {
    const store = new PrismaMediaStore(fakeClient({ withTenantId: false }));
    await store.save({ ...record, tenantId: 'org_1' });
    expect((await store.find('a'))?.id).toBe('a');
    expect(await store.count()).toBe(1);
  });

  it('enableTenancy fails with the fix when the model has no tenantId', async () => {
    const store = new PrismaMediaStore(fakeClient({ withTenantId: false }));
    await expect(store.enableTenancy()).rejects.toMatchObject({
      name: 'MediaTenancyUnavailableError',
      message: expect.stringContaining('tenantId String? @map("tenant_id")'),
    });
  });

  it('writes tenantId (null when absent) once enabled', async () => {
    const client = fakeClient();
    const store = new PrismaMediaStore(client);
    await store.enableTenancy();
    await store.save(record);
    expect(client.rows.get('a')?.tenantId).toBeNull();
  });
});
