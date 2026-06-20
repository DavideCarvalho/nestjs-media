import type { MediaRecord, MediaStore } from '@dudousxd/nestjs-media-core';

// Prisma's per-model query args are generated generics; left as `any` at this single
// boundary so a real, generated `PrismaClient` delegate is structurally assignable to
// `PrismaClientLike` (matches the canonical ecosystem prisma adapter). The adapter
// never imports `@prisma/client` (§3.10: the prisma schema is consumer-managed).
type Args = any;

/** Structural subset of the generated Prisma `media` delegate the store relies on. */
export interface PrismaMediaDelegate {
  upsert(args: Args): Promise<MediaRecord>;
  findUnique(args: Args): Promise<MediaRecord | null>;
  findMany(args: Args): Promise<MediaRecord[]>;
  deleteMany(args: Args): Promise<{ count: number }>;
  aggregate(args: Args): Promise<{ _max: { order: number | null } }>;
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
  constructor(private readonly prisma: PrismaClientLike) {}

  async save(record: MediaRecord): Promise<MediaRecord> {
    await this.prisma.media.upsert({ where: { id: record.id }, create: record, update: record });
    return record;
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
}
