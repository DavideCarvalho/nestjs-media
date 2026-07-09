import type { MediaRecord } from './media-record';

/** Filter for {@link MediaStore.count}. All fields AND together; omit for a global count. */
export interface MediaCountFilter {
  ownerType?: string;
  collection?: string;
  disk?: string;
}

/** Group-by aggregate query for {@link MediaStore.aggregate}. */
export interface MediaAggregateQuery {
  /** Column to group rows by. */
  groupBy: 'collection' | 'disk';
  /** Include a summed byte total per group when `'size'`. */
  sum?: 'size';
}

/** One group of the aggregate result. `sumSize` is 0 when `sum` was not requested. */
export interface MediaAggregateBucket {
  key: string;
  count: number;
  sumSize: number;
}

export type MediaAggregateResult = MediaAggregateBucket[];

/** Filter for {@link MediaStore.list}. All fields AND together; omit for an unfiltered listing. */
export interface MediaListFilter {
  ownerType?: string;
  collection?: string;
  disk?: string;
}

/** Pagination for {@link MediaStore.list}. `cursor` is opaque (from a prior result); `limit` defaults to 50. */
export interface MediaListPage {
  cursor?: string;
  limit?: number;
}

/** One page of {@link MediaStore.list}. `cursor` is absent on the final page. */
export interface MediaListResult {
  records: MediaRecord[];
  cursor?: string;
}

/**
 * Persistence SPI for media records. Implemented per ORM as a POJO that receives
 * the connection in its constructor (see §3.10 of the ecosystem audit).
 */
export interface MediaStore {
  save(record: MediaRecord): Promise<MediaRecord>;
  find(id: string): Promise<MediaRecord | null>;
  /** Records for an owner, optionally a single collection, ordered by `order` asc. */
  listByOwner(ownerType: string, ownerId: string, collection?: string): Promise<MediaRecord[]>;
  delete(id: string): Promise<void>;
  /** Next `order` value for appending to a collection (0-based). */
  nextOrder(ownerType: string, ownerId: string, collection: string): Promise<number>;
  /**
   * Global record count across all owners, optionally filtered. Dashboard/admin use.
   * Optional — additive/non-breaking for external stores; dashboard providers degrade
   * to an empty/zero shape when a store omits it.
   */
  count?(filter?: MediaCountFilter): Promise<number>;
  /**
   * Group-by rollup ({@link MediaAggregateBucket}[]) across all owners. Dashboard/admin
   * use. Optional — see {@link MediaStore.count}.
   */
  aggregate?(query: MediaAggregateQuery): Promise<MediaAggregateResult>;
  /**
   * Paginated global record listing across all owners, optionally filtered.
   * Ordered by `(createdAt, id)` ascending with an opaque keyset cursor.
   * Dashboard/admin use. Optional — see {@link MediaStore.count}.
   */
  list?(filter?: MediaListFilter, page?: MediaListPage): Promise<MediaListResult>;
}
