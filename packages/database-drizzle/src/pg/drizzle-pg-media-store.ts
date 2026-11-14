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
import { and, asc, count, eq, getTableColumns, gt, max, or, sum } from 'drizzle-orm';
import { decodeListCursor, encodeListCursor, isEncodedListCursor } from '../list-cursor';
import { assertTenantColumn, nameContainsCondition, selectable, tenantCondition } from '../tenancy';
import type { DrizzlePgDatabase } from './db';
import { type MediaPgTables, mediaPgTable, mediaPgTables } from './schema';

/** Options of the Drizzle Postgres stores. */
export interface DrizzlePgStoreOptions {
  /** The Postgres schema of the media tables (default: unqualified). See "Database schema". */
  schema?: string;
}

type MediaRow = Omit<typeof mediaPgTable.$inferSelect, 'tenantId'> & { tenantId?: string | null };

function toRecord(row: MediaRow): MediaRecord {
  return { ...row, size: Number(row.size) };
}

/** The `media` row of a record: `tenant_id` only once tenancy is on. */
function toRow(record: MediaRecord, tenancy: boolean) {
  const { tenantId, ...rest } = record;
  return tenancy ? { ...rest, tenantId: tenantId ?? null } : rest;
}

/**
 * `MediaStore` backed by Drizzle on **PostgreSQL**. POJO receiving any drizzle Postgres db
 * (see {@link DrizzlePgDatabase}). Migration-first: create the table with drizzle-kit from
 * `mediaPgTable`, or `createMediaPgTables(db)` in tests/dev.
 */
export class DrizzlePgMediaStore implements MediaStore {
  private tenancy = false;

  private readonly t: MediaPgTables;

  /**
   * `schema`: the Postgres schema the `media` table lives in. Every statement names it
   * (`search_path` is never used). Default: unqualified, the connection's current schema.
   */
  constructor(
    private readonly db: DrizzlePgDatabase,
    options: DrizzlePgStoreOptions = {},
  ) {
    this.t = mediaPgTables(options.schema);
  }

  /** The columns to read: `tenant_id` only once tenancy is on. */
  private get columns() {
    return selectable(getTableColumns(this.t.media), this.tenancy);
  }

  /**
   * Tenancy: checks the `tenant_id` column exists, then reads and writes it. Called by the
   * library when tenancy is on; until then the column is never touched.
   */
  async enableTenancy(): Promise<void> {
    await assertTenantColumn(
      'media',
      () => this.db.select({ tenantId: this.t.media.tenantId }).from(this.t.media).limit(1),
      'Generate a migration with drizzle-kit from `mediaPgTable` (or the tables of `mediaPgTables(schema)`; it declares `tenant_id` and the `idx_media_tenant` index), or run `ALTER TABLE media ADD COLUMN tenant_id text; CREATE INDEX idx_media_tenant ON media (tenant_id, owner_type, owner_id, collection);`.',
    );
    this.tenancy = true;
  }

  async save(record: MediaRecord): Promise<MediaRecord> {
    const row = toRow(record, this.tenancy);
    const { id: _id, ...rest } = row;
    // Off: through the table without `tenant_id`, which Drizzle would otherwise list in the INSERT.
    await this.db
      .insert(this.tenancy ? this.t.media : this.t.mediaWithoutTenant)
      .values(row)
      .onConflictDoUpdate({ target: this.t.media.id, set: rest });
    // What was persisted: off, no `tenantId` (the row has none to read back).
    return row as MediaRecord;
  }

  async find(id: string): Promise<MediaRecord | null> {
    const rows = await this.db
      .select(this.columns)
      .from(this.t.media)
      .where(eq(this.t.media.id, id))
      .limit(1);
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
        ? and(eq(this.t.media.ownerType, ownerType), eq(this.t.media.ownerId, ownerId))
        : and(
            eq(this.t.media.ownerType, ownerType),
            eq(this.t.media.ownerId, ownerId),
            eq(this.t.media.collection, collection),
          );
    const rows = await this.db
      .select(this.columns)
      .from(this.t.media)
      .where(where)
      .orderBy(asc(this.t.media.order), asc(this.t.media.id));
    return rows.map(toRecord);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(this.t.media).where(eq(this.t.media.id, id));
  }

  async nextOrder(ownerType: string, ownerId: string, collection: string): Promise<number> {
    const rows = await this.db
      .select({ max: max(this.t.media.order) })
      .from(this.t.media)
      .where(
        and(
          eq(this.t.media.ownerType, ownerType),
          eq(this.t.media.ownerId, ownerId),
          eq(this.t.media.collection, collection),
        ),
      );
    const top = rows[0]?.max;
    return top == null ? 0 : Number(top) + 1;
  }

  async count(filter: MediaCountFilter = {}): Promise<number> {
    const conditions = [
      ...(filter.ownerType !== undefined ? [eq(this.t.media.ownerType, filter.ownerType)] : []),
      ...(filter.collection !== undefined ? [eq(this.t.media.collection, filter.collection)] : []),
      ...(filter.disk !== undefined ? [eq(this.t.media.disk, filter.disk)] : []),
      ...(filter.tenant ? [tenantCondition(this.t.media.tenantId, filter.tenant)] : []),
    ];
    const rows = await this.db
      .select({ value: count() })
      .from(this.t.media)
      .where(conditions.length ? and(...conditions) : undefined);
    return Number(rows[0]?.value ?? 0);
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const column = query.groupBy === 'collection' ? this.t.media.collection : this.t.media.disk;
    const rows = await this.db
      .select({ key: column, count: count(), sumSize: sum(this.t.media.size) })
      .from(this.t.media)
      .where(query.tenant ? tenantCondition(this.t.media.tenantId, query.tenant) : undefined)
      .groupBy(column);
    return rows.map((row) => ({
      key: row.key,
      count: Number(row.count),
      // `sum(bigint)` is `numeric` in Postgres — drivers hand it back as a string.
      sumSize: query.sum === 'size' ? Number(row.sumSize ?? 0) : 0,
    }));
  }

  /** {@inheritDoc MediaStore.isListCursor} */
  isListCursor(cursor: string): boolean {
    return isEncodedListCursor(cursor);
  }

  async list(filter: MediaListFilter = {}, page: MediaListPage = {}): Promise<MediaListResult> {
    const limit = page.limit ?? 50;
    const cursor = page.cursor ? decodeListCursor(page.cursor) : null;

    const filterConditions = [
      ...(filter.ownerType !== undefined ? [eq(this.t.media.ownerType, filter.ownerType)] : []),
      ...(filter.collection !== undefined ? [eq(this.t.media.collection, filter.collection)] : []),
      ...(filter.disk !== undefined ? [eq(this.t.media.disk, filter.disk)] : []),
      ...(filter.nameContains !== undefined
        ? [nameContainsCondition(this.t.media.name, this.t.media.fileName, filter.nameContains)]
        : []),
      ...(filter.tenant ? [tenantCondition(this.t.media.tenantId, filter.tenant)] : []),
      ...(cursor
        ? [
            or(
              gt(this.t.media.createdAt, cursor.createdAt),
              and(eq(this.t.media.createdAt, cursor.createdAt), gt(this.t.media.id, cursor.id)),
            ),
          ]
        : []),
    ];

    const rows = await this.db
      .select(this.columns)
      .from(this.t.media)
      .where(filterConditions.length ? and(...filterConditions) : undefined)
      .orderBy(asc(this.t.media.createdAt), asc(this.t.media.id))
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
