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

// Prisma's per-model query args are generated generics; left as `any` at this single
// boundary so a real, generated `PrismaClient` delegate is structurally assignable to
// `PrismaClientLike` (matches the canonical ecosystem prisma adapter). The adapter
// never imports `@prisma/client` (§3.10: the prisma schema is consumer-managed).
type Args = any;

/** Opaque keyset cursor over `(createdAt, id)`; matches the other adapters' encoding. */
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

/** The matching rule as a Prisma `where` on `tenantId`. */
function tenantWhere(match: MediaTenantMatch): Record<string, unknown> {
  if (match.id === null) return { tenantId: null };
  return match.orNull
    ? { OR: [{ tenantId: match.id }, { tenantId: null }] }
    : { tenantId: match.id };
}

/** `MediaListFilter.nameContains`: `name` or `fileName` contains `text`, ignoring case. */
function matchesName(record: MediaRecord, text: string | undefined): boolean {
  if (text === undefined) return true;
  const needle = text.toLowerCase();
  return (
    record.name.toLowerCase().includes(needle) || record.fileName.toLowerCase().includes(needle)
  );
}

/** The `nameContains` rule as a Prisma `where`; `insensitive` adds `mode` (Postgres, MongoDB). */
function nameWhere(text: string, insensitive: boolean): Record<string, unknown> {
  const contains = insensitive ? { contains: text, mode: 'insensitive' } : { contains: text };
  return { OR: [{ name: contains }, { fileName: contains }] };
}

/** Whether `error` is Prisma refusing the `mode` argument (a provider without it: MySQL, SQLite). */
function rejectsMode(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /`mode`/.test(message);
}

/** Structural subset of the generated Prisma `media` delegate the store relies on. */
export interface PrismaMediaDelegate {
  upsert(args: Args): Promise<MediaRecord>;
  findUnique(args: Args): Promise<MediaRecord | null>;
  findMany(args: Args): Promise<MediaRecord[]>;
  deleteMany(args: Args): Promise<{ count: number }>;
  aggregate(args: Args): Promise<{ _max: { order: number | null } }>;
  count(args: Args): Promise<number>;
  groupBy(
    args: Args,
  ): Promise<Array<{ [key: string]: unknown; _count: number; _sum: { size: number | null } }>>;
}

/**
 * Pass your `PrismaClient` after adding the `Media` model from the documented schema
 * (map the `order` field to a `position` column via `@map`). Schema + migrations are
 * consumer-managed.
 */
export interface PrismaClientLike {
  media: PrismaMediaDelegate;
}

/**
 * MediaStore backed by Prisma. POJO receiving a structurally-typed client. Schema
 * is consumer-managed (the app owns its prisma schema + migrations).
 */
export class PrismaMediaStore implements MediaStore {
  private tenancy = false;
  /** Whether the provider takes `mode: 'insensitive'`; learned on the first name search. */
  private insensitiveMode = true;

  constructor(private readonly prisma: PrismaClientLike) {}

  /**
   * Tenancy: checks the `Media` model has `tenantId`, then writes it (reads return whatever the
   * model has). Called by the library when tenancy is on; until then `tenantId` is never written
   * or queried.
   */
  async enableTenancy(): Promise<void> {
    try {
      await this.prisma.media.findMany({ select: { tenantId: true }, take: 1 });
    } catch (error) {
      throw Object.assign(
        new MediaTenancyUnavailableError(
          'the Prisma `Media` model has no `tenantId` field',
          'Add `tenantId String? @map("tenant_id")` and `@@index([tenantId, ownerType, ownerId, collection])` to the model, then run `prisma migrate dev` and `prisma generate`.',
        ),
        { cause: error },
      );
    }
    this.tenancy = true;
  }

  async save(record: MediaRecord): Promise<MediaRecord> {
    const { tenantId, ...rest } = record;
    const data = this.tenancy ? { ...rest, tenantId: tenantId ?? null } : rest;
    await this.prisma.media.upsert({ where: { id: record.id }, create: data, update: data });
    // What was persisted: off, no `tenantId`.
    return data;
  }

  find(id: string): Promise<MediaRecord | null> {
    return this.prisma.media.findUnique({ where: { id } });
  }

  listByOwner(ownerType: string, ownerId: string, collection?: string): Promise<MediaRecord[]> {
    return this.prisma.media.findMany({
      where: { ownerType, ownerId, ...(collection !== undefined ? { collection } : {}) },
      orderBy: { order: 'asc' },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.media.deleteMany({ where: { id } });
  }

  async nextOrder(ownerType: string, ownerId: string, collection: string): Promise<number> {
    const result = await this.prisma.media.aggregate({
      where: { ownerType, ownerId, collection },
      _max: { order: true },
    });
    return result._max.order == null ? 0 : result._max.order + 1;
  }

  count(filter: MediaCountFilter = {}): Promise<number> {
    return this.prisma.media.count({
      where: {
        ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
        ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
        ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
        ...(filter.tenant ? { AND: [tenantWhere(filter.tenant)] } : {}),
      },
    });
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const rows = await this.prisma.media.groupBy({
      by: [query.groupBy],
      ...(query.tenant ? { where: tenantWhere(query.tenant) } : {}),
      _count: true,
      _sum: { size: true },
    });
    return rows.map((row) => {
      const key = row[query.groupBy];
      return {
        key: typeof key === 'string' ? key : String(key),
        count: Number(row._count),
        sumSize: query.sum === 'size' ? Number(row._sum.size ?? 0) : 0,
      };
    });
  }

  async list(filter: MediaListFilter = {}, page: MediaListPage = {}): Promise<MediaListResult> {
    const limit = page.limit ?? 50;
    const cursor = page.cursor !== undefined ? decodeListCursor(page.cursor) : null;
    const text = filter.nameContains;

    const query = (insensitive: boolean) => {
      const and = [
        ...(filter.tenant ? [tenantWhere(filter.tenant)] : []),
        ...(text !== undefined ? [nameWhere(text, insensitive)] : []),
      ];
      return this.prisma.media.findMany({
        where: {
          ...(filter.ownerType !== undefined ? { ownerType: filter.ownerType } : {}),
          ...(filter.collection !== undefined ? { collection: filter.collection } : {}),
          ...(filter.disk !== undefined ? { disk: filter.disk } : {}),
          ...(and.length > 0 ? { AND: and } : {}),
          ...(cursor
            ? {
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });
    };
    let rows: MediaRecord[];
    try {
      rows = await query(text !== undefined && this.insensitiveMode);
    } catch (error) {
      // MySQL and SQLite have no `mode`: their `contains` already ignores (ASCII) case.
      if (text === undefined || !this.insensitiveMode || !rejectsMode(error)) throw error;
      this.insensitiveMode = false;
      rows = await query(false);
    }

    const hasMore = rows.length > limit;
    const read = rows.slice(0, limit);
    // The cursor follows the last row read, so a page the exact name check thinned stays in order.
    const last = read[read.length - 1];
    const result: MediaListResult = { records: read.filter((r) => matchesName(r, text)) };
    if (hasMore && last !== undefined) {
      result.cursor = encodeListCursor(last);
    }
    return result;
  }
}
