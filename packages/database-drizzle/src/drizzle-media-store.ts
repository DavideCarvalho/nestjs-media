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
import { and, asc, count, eq, gt, max, or, sql, sum } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mediaTable } from './media.schema';

type DB = BetterSQLite3Database<Record<string, never>>;

/** Opaque keyset cursor over `(createdAt, id)`. Mirrors the in-memory store's encoding. */
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
  const createdAt = new Date(decoded.slice(0, separator));
  if (Number.isNaN(createdAt.getTime())) return null;
  const id = decoded.slice(separator + 1);
  return { createdAt, id };
}

/**
 * Migration-first (§3.10): Drizzle has no auto-ensure. Run migrations with
 * drizzle-kit in production; this helper creates the table for tests/dev.
 */
export function createMediaTable(db: DB): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS media (
      id text PRIMARY KEY NOT NULL,
      owner_type text NOT NULL,
      owner_id text NOT NULL,
      collection text NOT NULL,
      name text NOT NULL,
      file_name text NOT NULL,
      mime_type text NOT NULL,
      size integer NOT NULL,
      disk text NOT NULL,
      path text NOT NULL,
      position integer NOT NULL,
      custom_properties text NOT NULL,
      conversions text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_media_collection ON media (collection)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_media_disk ON media (disk)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_media_created_at ON media (created_at)`);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_media_collection_created_at
    ON media (collection, created_at, id)
  `);
}

/** MediaStore backed by Drizzle (better-sqlite3). POJO receiving the drizzle db. */
export class DrizzleMediaStore implements MediaStore {
  constructor(private readonly db: DB) {}

  async save(record: MediaRecord): Promise<MediaRecord> {
    await this.db
      .insert(mediaTable)
      .values(record)
      .onConflictDoUpdate({ target: mediaTable.id, set: record });
    return record;
  }

  async find(id: string): Promise<MediaRecord | null> {
    const rows = await this.db.select().from(mediaTable).where(eq(mediaTable.id, id)).limit(1);
    return (rows[0] as MediaRecord | undefined) ?? null;
  }

  async listByOwner(
    ownerType: string,
    ownerId: string,
    collection?: string,
  ): Promise<MediaRecord[]> {
    const where =
      collection === undefined
        ? and(eq(mediaTable.ownerType, ownerType), eq(mediaTable.ownerId, ownerId))
        : and(
            eq(mediaTable.ownerType, ownerType),
            eq(mediaTable.ownerId, ownerId),
            eq(mediaTable.collection, collection),
          );
    const rows = await this.db
      .select()
      .from(mediaTable)
      .where(where)
      .orderBy(asc(mediaTable.order));
    return rows as MediaRecord[];
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(mediaTable).where(eq(mediaTable.id, id));
  }

  async nextOrder(ownerType: string, ownerId: string, collection: string): Promise<number> {
    const rows = await this.db
      .select({ max: max(mediaTable.order) })
      .from(mediaTable)
      .where(
        and(
          eq(mediaTable.ownerType, ownerType),
          eq(mediaTable.ownerId, ownerId),
          eq(mediaTable.collection, collection),
        ),
      );
    const top = rows[0]?.max;
    return top == null ? 0 : Number(top) + 1;
  }

  async count(filter: MediaCountFilter = {}): Promise<number> {
    const conditions = [
      ...(filter.ownerType !== undefined ? [eq(mediaTable.ownerType, filter.ownerType)] : []),
      ...(filter.collection !== undefined ? [eq(mediaTable.collection, filter.collection)] : []),
      ...(filter.disk !== undefined ? [eq(mediaTable.disk, filter.disk)] : []),
    ];
    const rows = await this.db
      .select({ value: count() })
      .from(mediaTable)
      .where(conditions.length ? and(...conditions) : undefined);
    return Number(rows[0]?.value ?? 0);
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const column = query.groupBy === 'collection' ? mediaTable.collection : mediaTable.disk;
    const rows = await this.db
      .select({ key: column, count: count(), sumSize: sum(mediaTable.size) })
      .from(mediaTable)
      .groupBy(column);
    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
      sumSize: query.sum === 'size' ? Number(row.sumSize ?? 0) : 0,
    }));
  }

  async list(filter: MediaListFilter = {}, page: MediaListPage = {}): Promise<MediaListResult> {
    const limit = page.limit ?? 50;
    const cursor = page.cursor ? decodeListCursor(page.cursor) : null;

    const filterConditions = [
      ...(filter.ownerType !== undefined ? [eq(mediaTable.ownerType, filter.ownerType)] : []),
      ...(filter.collection !== undefined ? [eq(mediaTable.collection, filter.collection)] : []),
      ...(filter.disk !== undefined ? [eq(mediaTable.disk, filter.disk)] : []),
      ...(cursor
        ? [
            or(
              gt(mediaTable.createdAt, cursor.createdAt),
              and(eq(mediaTable.createdAt, cursor.createdAt), gt(mediaTable.id, cursor.id)),
            ),
          ]
        : []),
    ];

    const rows = await this.db
      .select()
      .from(mediaTable)
      .where(filterConditions.length ? and(...filterConditions) : undefined)
      .orderBy(asc(mediaTable.createdAt), asc(mediaTable.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const records = (rows.slice(0, limit) as MediaRecord[]).map((record) => ({ ...record }));
    const result: MediaListResult = { records };
    const lastRecord = records.at(-1);
    if (hasMore && lastRecord !== undefined) {
      result.cursor = encodeListCursor(lastRecord);
    }
    return result;
  }
}
