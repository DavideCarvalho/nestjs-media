import type { ExtensionContext } from '@dudousxd/nestjs-telescope';
import { describe, expect, it } from 'vitest';
import {
  mediaActiveUploadCountProvider,
  mediaAttachmentActivityProvider,
  mediaByCollectionProvider,
  mediaDisksProvider,
  mediaInProgressUploadsProvider,
  mediaLibraryTotalsProvider,
  mediaRecentUploadsProvider,
  mediaStorageByDiskProvider,
  mediaStorageWritesOverTimeProvider,
  mediaUploadSuccessRateProvider,
  mediaUploadThroughputProvider,
  mediaUploadsOverTimeProvider,
} from './media-data-providers';
import { MEDIA_STORAGE_SHARED, MEDIA_STORE, MEDIA_UPLOAD_SESSIONS } from './media-tokens';

// Resolve different host services by token identity.
function ctxWith(map: Map<unknown, unknown>): ExtensionContext {
  return {
    config: {} as ExtensionContext['config'],
    moduleRef: { get: (token: unknown) => map.get(token) } as unknown as ExtensionContext['moduleRef'],
  };
}

// Helper for storage-based providers: fakes TELESCOPE_STORAGE.get returning { data: entries }.
function storageCtx(entries: Array<{ content?: unknown; createdAt?: Date }>): ExtensionContext {
  const storage = { get: async () => ({ data: entries }) };
  return {
    config: {} as ExtensionContext['config'],
    moduleRef: { get: () => storage } as unknown as ExtensionContext['moduleRef'],
  };
}

describe('mediaInProgressUploadsProvider', () => {
  it('lists sessions with a computed percent', async () => {
    const sessions = {
      list: async () => [{ id: 'u1', disk: 'local', key: 'k', offset: 5, size: 10, parts: 1 }],
    };
    const map = new Map<unknown, unknown>([[MEDIA_UPLOAD_SESSIONS, sessions]]);
    const result = (await mediaInProgressUploadsProvider().resolve(undefined, ctxWith(map))) as {
      rows: Array<{ id: string; percent: number }>;
    };
    expect(result.rows[0]).toMatchObject({ id: 'u1', percent: 50 });
  });

  it('degrades to empty rows when the store is null or has no list()', async () => {
    const map = new Map<unknown, unknown>([[MEDIA_UPLOAD_SESSIONS, null]]);
    const result = (await mediaInProgressUploadsProvider().resolve(undefined, ctxWith(map))) as {
      rows: unknown[];
    };
    expect(result.rows).toEqual([]);
  });

  it('degrades to empty rows when the store has no list()', async () => {
    const map = new Map<unknown, unknown>([[MEDIA_UPLOAD_SESSIONS, {}]]);
    const result = (await mediaInProgressUploadsProvider().resolve(undefined, ctxWith(map))) as {
      rows: unknown[];
    };
    expect(result.rows).toEqual([]);
  });
});

describe('mediaActiveUploadCountProvider', () => {
  it('counts sessions', async () => {
    const sessions = { list: async () => [{ id: 'u1' }, { id: 'u2' }] };
    const result = (await mediaActiveUploadCountProvider().resolve(
      undefined,
      ctxWith(new Map([[MEDIA_UPLOAD_SESSIONS, sessions]])),
    )) as { value: number };
    expect(result.value).toBe(2);
  });

  it('degrades to zero when there is no session store', async () => {
    const result = (await mediaActiveUploadCountProvider().resolve(
      undefined,
      ctxWith(new Map([[MEDIA_UPLOAD_SESSIONS, null]])),
    )) as { value: number };
    expect(result.value).toBe(0);
  });
});

describe('mediaUploadSuccessRateProvider', () => {
  it('computes complete / (complete + abort)', async () => {
    const ctx = storageCtx([
      { content: { event: 'upload.complete' }, createdAt: new Date() },
      { content: { event: 'upload.complete' }, createdAt: new Date() },
      { content: { event: 'upload.abort' }, createdAt: new Date() },
    ]);
    const result = (await mediaUploadSuccessRateProvider().resolve({ windowMs: 0 }, ctx)) as {
      value: number;
    };
    expect(result.value).toBeCloseTo(2 / 3);
  });

  it('reports a perfect rate (1) when there are no upload events yet', async () => {
    const ctx = storageCtx([]);
    const result = (await mediaUploadSuccessRateProvider().resolve({ windowMs: 0 }, ctx)) as {
      value: number;
    };
    expect(result.value).toBe(1);
  });
});

describe('mediaUploadThroughputProvider', () => {
  it('reports completes/hour, ignoring the byte-undercounting direct-upload size:0 caveat', async () => {
    const now = Date.now();
    const ctx = storageCtx([
      { content: { event: 'upload.complete', size: 0 }, createdAt: new Date(now) },
      { content: { event: 'upload.complete', size: 100 }, createdAt: new Date(now) },
    ]);
    const result = (await mediaUploadThroughputProvider().resolve(
      { windowMs: 60 * 60 * 1000 },
      ctx,
    )) as { value: number; spark: number[] };
    expect(result.value).toBe(2);
    expect(result.spark).toHaveLength(8);
  });
});

describe('mediaLibraryTotalsProvider', () => {
  it('returns count for metric:count and summed bytes for metric:bytes', async () => {
    const store = {
      count: async () => 4,
      aggregate: async () => [{ key: 'local', count: 4, sumSize: 40 }],
    };
    const map = new Map<unknown, unknown>([[MEDIA_STORE, store]]);
    const total = (await mediaLibraryTotalsProvider().resolve(
      { metric: 'count' },
      ctxWith(map),
    )) as { value: number };
    const bytes = (await mediaLibraryTotalsProvider().resolve(
      { metric: 'bytes' },
      ctxWith(map),
    )) as { value: number };
    expect(total.value).toBe(4);
    expect(bytes.value).toBe(40);
  });

  it('degrades to zero when MEDIA_STORE is null', async () => {
    const result = (await mediaLibraryTotalsProvider().resolve(
      { metric: 'count' },
      ctxWith(new Map([[MEDIA_STORE, null]])),
    )) as { value: number };
    expect(result.value).toBe(0);
  });

  it('degrades to zero when the store omits count()/aggregate()', async () => {
    const map = new Map<unknown, unknown>([[MEDIA_STORE, {}]]);
    const total = (await mediaLibraryTotalsProvider().resolve(
      { metric: 'count' },
      ctxWith(map),
    )) as { value: number };
    const bytes = (await mediaLibraryTotalsProvider().resolve(
      { metric: 'bytes' },
      ctxWith(map),
    )) as { value: number };
    expect(total.value).toBe(0);
    expect(bytes.value).toBe(0);
  });
});

describe('mediaByCollectionProvider / mediaStorageByDiskProvider', () => {
  it('map aggregate buckets to breakdown segments', async () => {
    const store = {
      aggregate: async (query: { groupBy: string }) =>
        query.groupBy === 'collection'
          ? [{ key: 'gallery', count: 2, sumSize: 8 }]
          : [{ key: 'local', count: 3, sumSize: 30 }],
    };
    const map = new Map<unknown, unknown>([[MEDIA_STORE, store]]);
    const byCollection = (await mediaByCollectionProvider().resolve(undefined, ctxWith(map))) as {
      segments: Array<{ label: string; value: number }>;
    };
    const byDisk = (await mediaStorageByDiskProvider().resolve(undefined, ctxWith(map))) as {
      segments: Array<{ label: string; value: number }>;
    };
    expect(byCollection.segments).toEqual([{ label: 'gallery', value: 2 }]);
    expect(byDisk.segments).toEqual([{ label: 'local', value: 30 }]);
  });

  it('degrade to empty segments when MEDIA_STORE is null', async () => {
    const map = new Map<unknown, unknown>([[MEDIA_STORE, null]]);
    expect(await mediaByCollectionProvider().resolve(undefined, ctxWith(map))).toEqual({
      segments: [],
    });
    expect(await mediaStorageByDiskProvider().resolve(undefined, ctxWith(map))).toEqual({
      segments: [],
    });
  });
});

describe('mediaDisksProvider', () => {
  it('lists disk names with capability badges + default flag', async () => {
    const manager = {
      defaultDisk: 'local',
      diskNames: () => ['local', 's3'],
      disk: (name: string) => ({
        capabilities: { presign: name === 's3', multipart: name === 's3', publicUrls: true, list: true },
      }),
    };
    const result = (await mediaDisksProvider().resolve(
      undefined,
      ctxWith(new Map([[MEDIA_STORAGE_SHARED, manager]])),
    )) as { rows: Array<{ name: string; default: string; multipart: string }> };
    expect(result.rows.map((row) => row.name)).toEqual(['local', 's3']);
    expect(result.rows[0].default).toBe('yes');
    expect(result.rows[1].multipart).toBe('yes');
  });

  it('degrades to empty rows when the StorageManager is not reachable', async () => {
    const result = (await mediaDisksProvider().resolve(
      undefined,
      ctxWith(new Map([[MEDIA_STORAGE_SHARED, null]])),
    )) as { rows: unknown[] };
    expect(result.rows).toEqual([]);
  });
});

describe('mediaRecentUploads / mediaUploadsOverTime', () => {
  it('shape the recorded upload.* events into a table and series', async () => {
    const ctx = storageCtx([
      { content: { event: 'upload.complete', id: 'u1', disk: 'local', key: 'k', size: 10 }, createdAt: new Date() },
      { content: { event: 'upload.start', id: 'u2' }, createdAt: new Date() },
      { content: { event: 'upload.abort', id: 'u3' }, createdAt: new Date() },
    ]);
    const recent = (await mediaRecentUploadsProvider().resolve(undefined, ctx)) as {
      rows: Array<{ id: string }>;
    };
    expect(recent.rows.map((row) => row.id)).toContain('u1');
    const series = (await mediaUploadsOverTimeProvider().resolve({ buckets: 4 }, ctx)) as {
      rows: Array<{ label: string; started: number; completed: number; aborted: number }>;
    };
    expect(series.rows).toHaveLength(4);
    const totals = series.rows.reduce(
      (sum, row) => ({
        started: sum.started + row.started,
        completed: sum.completed + row.completed,
        aborted: sum.aborted + row.aborted,
      }),
      { started: 0, completed: 0, aborted: 0 },
    );
    expect(totals).toEqual({ started: 1, completed: 1, aborted: 1 });
  });
});

describe('mediaStorageWritesOverTimeProvider', () => {
  it('buckets attach events over time', async () => {
    const ctx = storageCtx([
      { content: { event: 'attach' }, createdAt: new Date() },
      { content: { event: 'conversion' }, createdAt: new Date() },
    ]);
    const result = (await mediaStorageWritesOverTimeProvider().resolve({ buckets: 3 }, ctx)) as {
      rows: Array<{ label: string; attach: number }>;
    };
    expect(result.rows).toHaveLength(3);
    expect(result.rows.reduce((sum, row) => sum + row.attach, 0)).toBe(1);
  });
});

describe('mediaAttachmentActivityProvider', () => {
  it('buckets attachment.create/attachment.delete events over time', async () => {
    const ctx = storageCtx([
      { content: { event: 'attachment.create' }, createdAt: new Date() },
      { content: { event: 'attachment.delete' }, createdAt: new Date() },
    ]);
    const result = (await mediaAttachmentActivityProvider().resolve({ buckets: 2 }, ctx)) as {
      rows: Array<{ label: string; created: number; deleted: number }>;
    };
    const totals = result.rows.reduce(
      (sum, row) => ({ created: sum.created + row.created, deleted: sum.deleted + row.deleted }),
      { created: 0, deleted: 0 },
    );
    expect(totals).toEqual({ created: 1, deleted: 1 });
  });
});
