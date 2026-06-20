import type { MediaRecord, MediaStore } from '@dudousxd/nestjs-media-core';

/** In-memory MediaStore for tests and the reference store-conformance suite. */
export class InMemoryMediaStore implements MediaStore {
  private readonly records = new Map<string, MediaRecord>();

  async save(record: MediaRecord): Promise<MediaRecord> {
    const copy = { ...record };
    this.records.set(copy.id, copy);
    return { ...copy };
  }

  async find(id: string): Promise<MediaRecord | null> {
    const found = this.records.get(id);
    return found ? { ...found } : null;
  }

  async listByOwner(
    ownerType: string,
    ownerId: string,
    collection?: string,
  ): Promise<MediaRecord[]> {
    return [...this.records.values()]
      .filter(
        (r) =>
          r.ownerType === ownerType &&
          r.ownerId === ownerId &&
          (collection === undefined || r.collection === collection),
      )
      .sort((a, b) => a.order - b.order)
      .map((r) => ({ ...r }));
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async nextOrder(ownerType: string, ownerId: string, collection: string): Promise<number> {
    const inCollection = await this.listByOwner(ownerType, ownerId, collection);
    return inCollection.reduce((max, r) => Math.max(max, r.order + 1), 0);
  }
}
