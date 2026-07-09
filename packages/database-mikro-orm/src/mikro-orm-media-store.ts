import type {
  MediaAggregateQuery,
  MediaAggregateResult,
  MediaCountFilter,
  MediaListFilter,
  MediaListPage,
  MediaListResult,
  MediaRecord,
  MediaStore,
} from '@dudousxd/nestjs-media-core';
import type { EntityManager, FilterQuery, MikroORM } from '@mikro-orm/core';
import { MediaEntity } from './media.entity';

/** Opaque keyset cursor over `(createdAt, id)`; matches the in-memory store's encoding. */
function encodeListCursor(record: MediaRecord): string {
  return Buffer.from(`${record.createdAt.toISOString()}|${record.id}`, 'utf8').toString('base64');
}

interface DecodedListCursor {
  createdAt: Date;
  id: string;
}

function decodeListCursor(cursor: string): DecodedListCursor | null {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator === -1) return null;
  return { createdAt: new Date(decoded.slice(0, separator)), id: decoded.slice(separator + 1) };
}

/**
 * Non-destructive schema management (§3.10). MikroORM gets create + add-column for
 * free via `updateSchema({ safe: true })` — it never drops or alters existing columns.
 */
export async function ensureMediaSchema(orm: MikroORM): Promise<void> {
  await orm.schema.update({ safe: true });
}

/**
 * MediaStore backed by MikroORM. POJO receiving an EntityManager; each operation
 * runs on a fork to avoid cross-request identity-map bleed.
 */
export class MikroOrmMediaStore implements MediaStore {
  constructor(private readonly em: EntityManager) {}

  async save(record: MediaRecord): Promise<MediaRecord> {
    const em = this.em.fork();
    await em.upsert(MediaEntity, { ...record });
    return record;
  }

  async find(id: string): Promise<MediaRecord | null> {
    const em = this.em.fork();
    return em.findOne(MediaEntity, { id });
  }

  async listByOwner(
    ownerType: string,
    ownerId: string,
    collection?: string,
  ): Promise<MediaRecord[]> {
    const em = this.em.fork();
    return em.find(
      MediaEntity,
      { ownerType, ownerId, ...(collection !== undefined ? { collection } : {}) },
      { orderBy: { order: 'asc' } },
    );
  }

  async delete(id: string): Promise<void> {
    const em = this.em.fork();
    await em.nativeDelete(MediaEntity, { id });
  }

  async nextOrder(ownerType: string, ownerId: string, collection: string): Promise<number> {
    const em = this.em.fork();
    const rows = await em.find(MediaEntity, { ownerType, ownerId, collection });
    return rows.reduce((max, r) => Math.max(max, r.order + 1), 0);
  }

  async count(filter: MediaCountFilter = {}): Promise<number> {
    const em = this.em.fork();
    return em.count(MediaEntity, {
      ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
      ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
      ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
    });
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const em = this.em.fork();
    const rows: Array<{ key: string; count: number | string; sumSize: number | string | null }> =
      await em
        .getConnection()
        .execute<Array<{ key: string; count: number | string; sumSize: number | string | null }>>(
          `select ${query.groupBy} as "key", count(*) as "count", sum(size) as "sumSize" from media group by ${query.groupBy}`,
          [],
          'all',
        );
    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
      sumSize: query.sum === 'size' ? Number(row.sumSize ?? 0) : 0,
    }));
  }

  async list(filter: MediaListFilter = {}, page: MediaListPage = {}): Promise<MediaListResult> {
    const em = this.em.fork();
    const limit = page.limit ?? 50;
    const cursor = page.cursor !== undefined ? decodeListCursor(page.cursor) : null;

    const where: FilterQuery<MediaRecord> = {
      ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
      ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
      ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
      ...(cursor !== null
        ? {
            $or: [
              { createdAt: { $gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { $gt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await em.find(MediaEntity, where, {
      orderBy: { createdAt: 'asc', id: 'asc' },
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const records = rows.slice(0, limit);
    const last = records[records.length - 1];
    const result: MediaListResult = { records };
    if (hasMore && last !== undefined) {
      result.cursor = encodeListCursor(last);
    }
    return result;
  }
}
