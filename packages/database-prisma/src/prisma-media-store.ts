import type { MediaRecord, MediaStore } from '@dudousxd/nestjs-media-core';

/**
 * Structural subset of the generated Prisma `media` delegate. Declared here so the
 * adapter never imports `@prisma/client` (§3.10: prisma schema is consumer-managed).
 * The consumer's model must expose these fields (map `order` to a `position` column
 * if desired via `@map`).
 */
export interface PrismaMediaDelegate {
  upsert(args: {
    where: { id: string };
    create: MediaRecord;
    update: MediaRecord;
  }): Promise<unknown>;
  findUnique(args: { where: { id: string } }): Promise<MediaRecord | null>;
  findMany(args: {
    where: { ownerType: string; ownerId: string; collection?: string };
    orderBy: { order: 'asc' | 'desc' };
  }): Promise<MediaRecord[]>;
  deleteMany(args: { where: { id: string } }): Promise<unknown>;
  aggregate(args: {
    where: { ownerType: string; ownerId: string; collection: string };
    _max: { order: true };
  }): Promise<{ _max: { order: number | null } }>;
}

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
