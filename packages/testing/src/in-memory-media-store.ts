import type {
  MediaAggregateQuery,
  MediaAggregateResult,
  MediaCountFilter,
  MediaRecord,
  MediaStore,
} from '@dudousxd/nestjs-media-core';

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

  async count(filter: MediaCountFilter = {}): Promise<number> {
    return [...this.records.values()].filter(
      (r) =>
        (filter.ownerType === undefined || r.ownerType === filter.ownerType) &&
        (filter.collection === undefined || r.collection === filter.collection) &&
        (filter.disk === undefined || r.disk === filter.disk),
    ).length;
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const buckets = new Map<string, { key: string; count: number; sumSize: number }>();
    for (const record of this.records.values()) {
      const key = query.groupBy === 'collection' ? record.collection : record.disk;
      const bucket = buckets.get(key) ?? { key, count: 0, sumSize: 0 };
      bucket.count += 1;
      if (query.sum === 'size') bucket.sumSize += record.size;
      buckets.set(key, bucket);
    }
    return [...buckets.values()];
  }
}
