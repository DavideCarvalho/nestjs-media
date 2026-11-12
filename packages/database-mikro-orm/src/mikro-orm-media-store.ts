import type {
  MediaAggregateQuery,
  MediaAggregateResult,
  MediaCountFilter,
  MediaListFilter,
  MediaListPage,
  MediaListResult,
  MediaRecord,
  MediaStore,
  MediaTenantMatch,
} from '@dudousxd/nestjs-media-core';
import { MediaTenancyUnavailableError } from '@dudousxd/nestjs-media-core';
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
  const createdAt = new Date(decoded.slice(0, separator));
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id: decoded.slice(separator + 1) };
}

/** The matching rule as a MikroORM filter on `tenantId`. */
function tenantWhere(match: MediaTenantMatch): FilterQuery<MediaRecord> {
  if (match.id === null) return { tenantId: null };
  return match.orNull
    ? { $or: [{ tenantId: match.id }, { tenantId: null }] }
    : { tenantId: match.id };
}

/** The matching rule as raw SQL for {@link MikroOrmMediaStore.aggregate}. */
function tenantSql(match: MediaTenantMatch | undefined): { sql: string; params: unknown[] } {
  if (!match) return { sql: '', params: [] };
  if (match.id === null) return { sql: ' where tenant_id is null', params: [] };
  return match.orNull
    ? { sql: ' where (tenant_id = ? or tenant_id is null)', params: [match.id] }
    : { sql: ' where tenant_id = ?', params: [match.id] };
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
  private tenancy = false;

  constructor(private readonly em: EntityManager) {}

  /**
   * Tenancy: checks the `tenant_id` column exists, then reads and writes it. Called by the
   * library when tenancy is on; until then the column is never touched.
   */
  async enableTenancy(): Promise<void> {
    try {
      await this.em.fork().getConnection().execute('select tenant_id from media limit 1');
    } catch (error) {
      throw Object.assign(
        new MediaTenancyUnavailableError(
          'the `media` table has no `tenant_id` column',
          'Run `ensureMediaSchema(orm)` (or `orm.schema.update({ safe: true })`), or create a migration with the MikroORM CLI: `MediaEntity` declares `tenant_id` and the `idx_media_tenant` index.',
        ),
        { cause: error },
      );
    }
    this.tenancy = true;
  }

  /** `populate` that loads the lazy `tenantId` once tenancy is on. */
  private get withTenant() {
    return this.tenancy ? { populate: ['tenantId'] as never } : {};
  }

  async save(record: MediaRecord): Promise<MediaRecord> {
    const em = this.em.fork();
    const { tenantId, ...rest } = record;
    const data = this.tenancy ? { ...rest, tenantId: tenantId ?? null } : rest;
    await em.upsert(MediaEntity, data);
    // What was persisted: off, no `tenantId`.
    return data;
  }

  async find(id: string): Promise<MediaRecord | null> {
    const em = this.em.fork();
    return em.findOne(MediaEntity, { id }, this.withTenant);
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
      { orderBy: { order: 'asc' }, ...this.withTenant },
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
    const where: FilterQuery<MediaRecord> = {
      ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
      ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
      ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
    };
    return em.count(
      MediaEntity,
      filter.tenant ? { $and: [where, tenantWhere(filter.tenant)] } : where,
    );
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const em = this.em.fork();
    const tenant = tenantSql(query.tenant);
    const rows: Array<{ key: string; count: number | string; sumSize: number | string | null }> =
      await em
        .getConnection()
        .execute<Array<{ key: string; count: number | string; sumSize: number | string | null }>>(
          `select ${query.groupBy} as "key", count(*) as "count", sum(size) as "sumSize" from media${tenant.sql} group by ${query.groupBy}`,
          tenant.params,
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

    const rows = await em.find(
      MediaEntity,
      filter.tenant ? { $and: [where, tenantWhere(filter.tenant)] } : where,
      { orderBy: { createdAt: 'asc', id: 'asc' }, limit: limit + 1, ...this.withTenant },
    );

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
