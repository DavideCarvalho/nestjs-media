import { describe, expect, it } from 'vitest';
import type {
  MediaAggregateQuery,
  MediaAggregateResult,
  MediaCountFilter,
  MediaStore,
} from './media-store';

describe('MediaStore aggregate SPI', () => {
  it('types the optional count() and aggregate() on the interface', async () => {
    const filter: MediaCountFilter = { disk: 'local' };
    const query: MediaAggregateQuery = { groupBy: 'collection', sum: 'size' };
    const result: MediaAggregateResult = [{ key: 'gallery', count: 2, sumSize: 8 }];
    const store: Pick<MediaStore, 'count' | 'aggregate'> = {
      count: async (f?: MediaCountFilter) => (f?.disk === 'local' ? 3 : 0),
      aggregate: async (q: MediaAggregateQuery) => (q.groupBy === 'collection' ? result : []),
    };
    expect(await store.count?.(filter)).toBe(3);
    expect(await store.aggregate?.(query)).toEqual(result);
  });

  it('a store may omit count()/aggregate() entirely and still satisfy MediaStore', () => {
    const store: Pick<MediaStore, 'save' | 'find' | 'listByOwner' | 'delete' | 'nextOrder'> = {
      save: async (record) => record,
      find: async () => null,
      listByOwner: async () => [],
      delete: async () => {},
      nextOrder: async () => 0,
    };
    const asMediaStore: MediaStore = store;
    expect(asMediaStore.count).toBeUndefined();
    expect(asMediaStore.aggregate).toBeUndefined();
  });
});
