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
import { and, asc, count, eq, getTableColumns, gt, max, or, sql, sum } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { decodeListCursor, encodeListCursor } from './list-cursor';
import { mediaTableWithoutTenant } from './media-columns';
import { mediaTable } from './media.schema';
import { assertTenantColumn, selectable, tenantCondition } from './tenancy';

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
      updated_at integer NOT NULL,
      tenant_id text
    )
  `);
  const columns = db.all<{ name: string }>(sql`PRAGMA table_info(media)`);
  if (!columns.some((column) => column.name === 'tenant_id')) {
    db.run(sql`ALTER TABLE media ADD COLUMN tenant_id text`);
  }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_media_collection ON media (collection)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_media_disk ON media (disk)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_media_created_at ON media (created_at)`);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_media_collection_created_at
    ON media (collection, created_at, id)
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_media_tenant
    ON media (tenant_id, owner_type, owner_id, collection)
  `);
}

/** The `media` row of a record: `tenant_id` only once tenancy is on. */
function toRow(record: MediaRecord, tenancy: boolean) {
  const { tenantId, ...rest } = record;
  return tenancy ? { ...rest, tenantId: tenantId ?? null } : rest;
}

/** MediaStore backed by Drizzle (better-sqlite3). POJO receiving the drizzle db. */
export class DrizzleMediaStore implements MediaStore {
  private tenancy = false;

  constructor(private readonly db: DB) {}

  /** The columns to read: `tenant_id` only once tenancy is on. */
  private get columns() {
    return selectable(getTableColumns(mediaTable), this.tenancy);
  }

  /**
   * Tenancy: checks the `tenant_id` column exists, then reads and writes it. Called by the
   * library when tenancy is on; until then the column is never touched.
   */
  async enableTenancy(): Promise<void> {
    await assertTenantColumn(
      'media',
      () => this.db.select({ tenantId: mediaTable.tenantId }).from(mediaTable).limit(1),
      'Generate a migration with drizzle-kit from `mediaTable` (it declares `tenant_id` and the `idx_media_tenant` index), or run `ALTER TABLE media ADD COLUMN tenant_id text; CREATE INDEX idx_media_tenant ON media (tenant_id, owner_type, owner_id, collection);`.',
    );
    this.tenancy = true;
  }

  async save(record: MediaRecord): Promise<MediaRecord> {
    const row = toRow(record, this.tenancy);
    // Off: through the table without `tenant_id`, which Drizzle would otherwise list in the INSERT.
    await this.db
      .insert(this.tenancy ? mediaTable : mediaTableWithoutTenant)
      .values(row)
      .onConflictDoUpdate({ target: mediaTable.id, set: row });
    // What was persisted: off, no `tenantId` (the row has none to read back).
    return row as MediaRecord;
  }

  async find(id: string): Promise<MediaRecord | null> {
    const rows = await this.db
      .select(this.columns)
      .from(mediaTable)
      .where(eq(mediaTable.id, id))
      .limit(1);
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
      .select(this.columns)
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
      ...(filter.tenant ? [tenantCondition(mediaTable.tenantId, filter.tenant)] : []),
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
      .where(query.tenant ? tenantCondition(mediaTable.tenantId, query.tenant) : undefined)
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
      ...(filter.tenant ? [tenantCondition(mediaTable.tenantId, filter.tenant)] : []),
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
      .select(this.columns)
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
