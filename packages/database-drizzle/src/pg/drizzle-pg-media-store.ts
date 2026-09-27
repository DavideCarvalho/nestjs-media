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
import { and, asc, count, eq, gt, max, or, sum } from 'drizzle-orm';
import { decodeListCursor, encodeListCursor } from '../list-cursor';
import type { DrizzlePgDatabase } from './db';
import { mediaPgTable } from './schema';

type MediaRow = typeof mediaPgTable.$inferSelect;

function toRecord(row: MediaRow): MediaRecord {
  return { ...row, size: Number(row.size) };
}

/**
 * `MediaStore` backed by Drizzle on **PostgreSQL**. POJO receiving any drizzle Postgres db
 * (see {@link DrizzlePgDatabase}). Migration-first: create the table with drizzle-kit from
 * `mediaPgTable`, or `createMediaPgTables(db)` in tests/dev.
 */
export class DrizzlePgMediaStore implements MediaStore {
  constructor(private readonly db: DrizzlePgDatabase) {}

  async save(record: MediaRecord): Promise<MediaRecord> {
    const { id: _id, ...rest } = record;
    await this.db
      .insert(mediaPgTable)
      .values(record)
      .onConflictDoUpdate({ target: mediaPgTable.id, set: rest });
    return record;
  }

  async find(id: string): Promise<MediaRecord | null> {
    const rows = await this.db.select().from(mediaPgTable).where(eq(mediaPgTable.id, id)).limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async listByOwner(
    ownerType: string,
    ownerId: string,
    collection?: string,
  ): Promise<MediaRecord[]> {
    const where =
      collection === undefined
        ? and(eq(mediaPgTable.ownerType, ownerType), eq(mediaPgTable.ownerId, ownerId))
        : and(
            eq(mediaPgTable.ownerType, ownerType),
            eq(mediaPgTable.ownerId, ownerId),
            eq(mediaPgTable.collection, collection),
          );
    const rows = await this.db
      .select()
      .from(mediaPgTable)
      .where(where)
      .orderBy(asc(mediaPgTable.order), asc(mediaPgTable.id));
    return rows.map(toRecord);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(mediaPgTable).where(eq(mediaPgTable.id, id));
  }

  async nextOrder(ownerType: string, ownerId: string, collection: string): Promise<number> {
    const rows = await this.db
      .select({ max: max(mediaPgTable.order) })
      .from(mediaPgTable)
      .where(
        and(
          eq(mediaPgTable.ownerType, ownerType),
          eq(mediaPgTable.ownerId, ownerId),
          eq(mediaPgTable.collection, collection),
        ),
      );
    const top = rows[0]?.max;
    return top == null ? 0 : Number(top) + 1;
  }

  async count(filter: MediaCountFilter = {}): Promise<number> {
    const conditions = [
      ...(filter.ownerType !== undefined ? [eq(mediaPgTable.ownerType, filter.ownerType)] : []),
      ...(filter.collection !== undefined ? [eq(mediaPgTable.collection, filter.collection)] : []),
      ...(filter.disk !== undefined ? [eq(mediaPgTable.disk, filter.disk)] : []),
    ];
    const rows = await this.db
      .select({ value: count() })
      .from(mediaPgTable)
      .where(conditions.length ? and(...conditions) : undefined);
    return Number(rows[0]?.value ?? 0);
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const column = query.groupBy === 'collection' ? mediaPgTable.collection : mediaPgTable.disk;
    const rows = await this.db
      .select({ key: column, count: count(), sumSize: sum(mediaPgTable.size) })
      .from(mediaPgTable)
      .groupBy(column);
    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
      // `sum(bigint)` is `numeric` in Postgres — drivers hand it back as a string.
      sumSize: query.sum === 'size' ? Number(row.sumSize ?? 0) : 0,
    }));
  }

  async list(filter: MediaListFilter = {}, page: MediaListPage = {}): Promise<MediaListResult> {
    const limit = page.limit ?? 50;
    const cursor = page.cursor ? decodeListCursor(page.cursor) : null;

    const filterConditions = [
      ...(filter.ownerType !== undefined ? [eq(mediaPgTable.ownerType, filter.ownerType)] : []),
      ...(filter.collection !== undefined ? [eq(mediaPgTable.collection, filter.collection)] : []),
      ...(filter.disk !== undefined ? [eq(mediaPgTable.disk, filter.disk)] : []),
      ...(cursor
        ? [
            or(
              gt(mediaPgTable.createdAt, cursor.createdAt),
              and(eq(mediaPgTable.createdAt, cursor.createdAt), gt(mediaPgTable.id, cursor.id)),
            ),
          ]
        : []),
    ];

    const rows = await this.db
      .select()
      .from(mediaPgTable)
      .where(filterConditions.length ? and(...filterConditions) : undefined)
      .orderBy(asc(mediaPgTable.createdAt), asc(mediaPgTable.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const records = rows.slice(0, limit).map(toRecord);
    const result: MediaListResult = { records };
    const lastRecord = records.at(-1);
    if (hasMore && lastRecord !== undefined) {
      result.cursor = encodeListCursor(lastRecord);
    }
    return result;
  }
}
