import type {
  MediaAggregateQuery,
  MediaAggregateResult,
  MediaCountFilter,
  MediaRecord,
  MediaStore,
} from '@dudousxd/nestjs-media-core';
import { and, asc, count, eq, max, sql, sum } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mediaTable } from './media.schema';

type DB = BetterSQLite3Database<Record<string, never>>;

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
}
