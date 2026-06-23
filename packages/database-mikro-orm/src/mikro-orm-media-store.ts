import type { MediaRecord, MediaStore } from '@dudousxd/nestjs-media-core';
import type { EntityManager, MikroORM } from '@mikro-orm/core';
import { MediaEntity } from './media.entity';

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
}
