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
import { matchesTenant } from '@dudousxd/nestjs-media-core';

/** `MediaListFilter.nameContains`: `name` or `fileName` contains `text`, ignoring case. */
function matchesName(record: MediaRecord, text: string | undefined): boolean {
  if (text === undefined) return true;
  const needle = text.toLowerCase();
  return (
    record.name.toLowerCase().includes(needle) || record.fileName.toLowerCase().includes(needle)
  );
}

/** Opaque keyset cursor over `(createdAt, id)`. */
function encodeCursor(record: MediaRecord): string {
  return Buffer.from(`${record.createdAt.toISOString()}|${record.id}`, 'utf8').toString('base64');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator === -1) return null;
  return { createdAt: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
}

/**
 * Whether `cursor` is exactly what {@link encodeCursor} produces for some record: base64 of
 * `<ISO createdAt>|<id>`, canonical (it re-encodes to itself), with a real timestamp and an id.
 */
function isEncodedListCursor(cursor: string): boolean {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64') !== cursor) return false;
  const separator = decoded.indexOf('|');
  if (separator === -1 || separator === decoded.length - 1) return false;
  const createdAt = decoded.slice(0, separator);
  const date = new Date(createdAt);
  return !Number.isNaN(date.getTime()) && date.toISOString() === createdAt;
}

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
        (filter.disk === undefined || r.disk === filter.disk) &&
        matchesTenant(filter.tenant, r.tenantId),
    ).length;
  }

  async aggregate(query: MediaAggregateQuery): Promise<MediaAggregateResult> {
    const buckets = new Map<string, { key: string; count: number; sumSize: number }>();
    for (const record of this.records.values()) {
      if (!matchesTenant(query.tenant, record.tenantId)) continue;
      const key = query.groupBy === 'collection' ? record.collection : record.disk;
      const bucket = buckets.get(key) ?? { key, count: 0, sumSize: 0 };
      bucket.count += 1;
      if (query.sum === 'size') bucket.sumSize += record.size;
      buckets.set(key, bucket);
    }
    return [...buckets.values()];
  }

  /** {@inheritDoc MediaStore.isListCursor} */
  isListCursor(cursor: string): boolean {
    return isEncodedListCursor(cursor);
  }

  async list(filter: MediaListFilter = {}, page: MediaListPage = {}): Promise<MediaListResult> {
    const limit = page.limit ?? 50;
    const after = page.cursor ? decodeCursor(page.cursor) : null;
    const ordered = [...this.records.values()]
      .filter(
        (r) =>
          (filter.ownerType === undefined || r.ownerType === filter.ownerType) &&
          (filter.collection === undefined || r.collection === filter.collection) &&
          (filter.disk === undefined || r.disk === filter.disk) &&
          matchesName(r, filter.nameContains) &&
          matchesTenant(filter.tenant, r.tenantId),
      )
      .sort((a, b) => {
        const byDate = a.createdAt.getTime() - b.createdAt.getTime();
        return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
      });
    const start = after
      ? ordered.findIndex(
          (r) =>
            r.createdAt.toISOString() > after.createdAt ||
            (r.createdAt.toISOString() === after.createdAt && r.id > after.id),
        )
      : 0;
    const window = start === -1 ? [] : ordered.slice(start, start + limit + 1);
    const hasMore = window.length > limit;
    const records = window.slice(0, limit).map((r) => ({ ...r }));
    const last = records.at(-1);
    return hasMore && last ? { records, cursor: encodeCursor(last) } : { records };
  }

  /** Tenancy needs no schema here: `tenantId` is kept on the record as is. */
  async enableTenancy(): Promise<void> {}
}
