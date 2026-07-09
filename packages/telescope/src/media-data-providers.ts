import type { MediaStore, StorageManager, UploadSession, UploadSessionStore } from '@dudousxd/nestjs-media-core';
import type { DataProvider, Entry, ExtensionContext } from '@dudousxd/nestjs-telescope';
import { TELESCOPE_STORAGE } from '@dudousxd/nestjs-telescope';
import { MEDIA_STORAGE_SHARED, MEDIA_STORE, MEDIA_UPLOAD_SESSIONS } from './media-tokens';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** The two fields every provider below reads off a Telescope entry. */
type StorageEntry = Pick<Entry, 'content' | 'createdAt'>;

/** The shape a recorded `media` diagnostic event's `content` carries, narrowed via guards. */
interface MediaEventContent {
  event?: string | undefined;
  id?: string | undefined;
  disk?: string | undefined;
  key?: string | undefined;
  size?: number | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

/** Narrow an entry's untyped `content` into the fields the providers below use. */
function eventOf(entry: StorageEntry): MediaEventContent {
  if (!isRecord(entry.content)) return {};
  return {
    event: stringField(entry.content, 'event'),
    id: stringField(entry.content, 'id'),
    disk: stringField(entry.content, 'disk'),
    key: stringField(entry.content, 'key'),
    size: numberField(entry.content, 'size'),
  };
}

/** Minimal surface of `TELESCOPE_STORAGE` this file needs. */
interface EntryStorage {
  get(query: { type?: string; limit?: number }): Promise<{ data: StorageEntry[] }>;
}

/** Fetch the recorded `media` entries from Telescope's own storage (bounded page). */
async function fetchMediaEntries(ctx: ExtensionContext): Promise<StorageEntry[]> {
  const storage = ctx.moduleRef.get<EntryStorage | null>(TELESCOPE_STORAGE, { strict: false });
  if (!storage) return [];
  const page = await storage.get({ type: 'media', limit: 5_000 });
  return page.data;
}

/** Split entries into current (now-windowMs, now] and previous equal window. windowMs<=0 = all in current. */
function splitWindows(
  entries: StorageEntry[],
  windowMs: number,
  now: number,
): { current: StorageEntry[]; previous: StorageEntry[] } {
  if (windowMs <= 0) return { current: entries, previous: [] };
  const start = now - windowMs;
  const prevStart = start - windowMs;
  const at = (entry: StorageEntry) => (entry.createdAt ? +new Date(entry.createdAt) : 0);
  return {
    current: entries.filter((entry) => at(entry) > start && at(entry) <= now),
    previous: entries.filter((entry) => at(entry) > prevStart && at(entry) <= start),
  };
}

function countEvent(entries: StorageEntry[], event: string): number {
  return entries.filter((entry) => eventOf(entry).event === event).length;
}

/** Build N equal-width time buckets spanning from the oldest entry to now, each starting empty. */
function timeBuckets<TExtra extends Record<string, number>>(
  entries: StorageEntry[],
  count: number,
  emptyRow: () => TExtra,
): { rows: Array<{ label: string } & TExtra>; minTime: number; bucketSize: number } {
  const now = Date.now();
  let minTime = now;
  for (const entry of entries) {
    const at = entry.createdAt ? +new Date(entry.createdAt) : now;
    if (at < minTime) minTime = at;
  }
  const span = Math.max(now - minTime, 1);
  const bucketSize = span / count;
  const rows = Array.from({ length: count }, (_, index) => {
    const label = new Date(minTime + index * bucketSize).toISOString().slice(11, 16);
    return { label, ...emptyRow() };
  });
  return { rows, minTime, bucketSize };
}

function bucketIndexFor(entry: StorageEntry, minTime: number, bucketSize: number, count: number): number {
  const at = entry.createdAt ? +new Date(entry.createdAt) : minTime;
  return Math.min(count - 1, Math.max(0, Math.floor((at - minTime) / bucketSize)));
}

// ─── Live uploads (MEDIA_UPLOAD_SESSIONS token) ────────────────────────────────

async function listSessions(ctx: ExtensionContext): Promise<UploadSession[]> {
  const store = ctx.moduleRef.get<UploadSessionStore | null>(MEDIA_UPLOAD_SESSIONS, {
    strict: false,
  });
  if (!store || typeof store.list !== 'function') return [];
  return store.list();
}

/** In-progress uploads table. [new-token] — empty when the store is null or lacks list(). */
export function mediaInProgressUploadsProvider(): DataProvider {
  return {
    name: 'media.inProgressUploads',
    async resolve(_query, ctx) {
      const sessions = await listSessions(ctx);
      const rows = sessions.map((session) => ({
        id: session.id,
        disk: session.disk,
        key: session.key,
        offset: session.offset,
        size: session.size ?? 0,
        percent: session.size ? Math.round((session.offset / session.size) * 100) : 0,
        parts: session.parts,
        multipart: session.multipartUploadId ? 'yes' : 'no',
      }));
      return { rows };
    },
  };
}

/** Active upload count stat. [new-token] */
export function mediaActiveUploadCountProvider(): DataProvider {
  return {
    name: 'media.activeUploadCount',
    async resolve(_query, ctx) {
      return { value: (await listSessions(ctx)).length };
    },
  };
}

// ─── Upload activity (event history) ───────────────────────────────────────────

/** Upload success rate = complete / (complete + abort) over the window. [new-events] */
export function mediaUploadSuccessRateProvider(): DataProvider {
  return {
    name: 'media.uploadSuccessRate',
    async resolve(query, ctx) {
      const windowMs = Number(query?.windowMs ?? 24 * 60 * 60 * 1000);
      const { current } = splitWindows(await fetchMediaEntries(ctx), windowMs, Date.now());
      const completed = countEvent(current, 'upload.complete');
      const aborted = countEvent(current, 'upload.abort');
      const total = completed + aborted;
      return { value: total === 0 ? 1 : completed / total, min: 0, max: 1 };
    },
  };
}

/** Uploads over time — started/completed/aborted per bucket. [new-events] */
export function mediaUploadsOverTimeProvider(): DataProvider {
  return {
    name: 'media.uploadsOverTime',
    async resolve(query, ctx) {
      const entries = await fetchMediaEntries(ctx);
      const buckets = Number(query?.buckets ?? 24);
      const { rows, minTime, bucketSize } = timeBuckets(entries, buckets, () => ({
        started: 0,
        completed: 0,
        aborted: 0,
      }));
      for (const entry of entries) {
        const event = eventOf(entry).event;
        if (event !== 'upload.start' && event !== 'upload.complete' && event !== 'upload.abort') {
          continue;
        }
        const row = rows[bucketIndexFor(entry, minTime, bucketSize, buckets)];
        if (!row) continue;
        if (event === 'upload.start') row.started += 1;
        else if (event === 'upload.complete') row.completed += 1;
        else row.aborted += 1;
      }
      return { rows };
    },
  };
}

/**
 * Upload throughput (completes per hour) + 8-bucket spark. [new-events]
 *
 * CAVEAT: `upload.progress` is deliberately not persisted (see `media.watcher.ts`), so
 * per-upload progress curves are unavailable. And the direct-upload (S3 presigned
 * multipart) completion path emits `upload.complete` with `size: 0` (`direct-upload.ts`
 * `completeUpload`, which has no visibility into the total bytes the client PUT directly
 * to S3) — a byte-rate metric would silently undercount direct uploads. We therefore
 * report COMPLETES/hour (count-based), not bytes/s.
 */
export function mediaUploadThroughputProvider(): DataProvider {
  return {
    name: 'media.uploadThroughput',
    async resolve(query, ctx) {
      const windowMs = Number(query?.windowMs ?? 24 * 60 * 60 * 1000);
      const now = Date.now();
      const { current, previous } = splitWindows(await fetchMediaEntries(ctx), windowMs, now);
      const hours = windowMs > 0 ? windowMs / (60 * 60 * 1000) : 1;
      const value = countEvent(current, 'upload.complete') / hours;
      const previousValue = countEvent(previous, 'upload.complete') / hours;
      const delta = previous.length > 0 ? value - previousValue : undefined;
      const sparkBuckets = 8;
      const bucketMs = (windowMs > 0 ? windowMs : now) / sparkBuckets;
      const bucketHours = bucketMs / (60 * 60 * 1000);
      const start = now - (windowMs > 0 ? windowMs : now);
      const spark = Array.from({ length: sparkBuckets }, (_, index) => {
        const from = start + index * bucketMs;
        const bucket = current.filter((entry) => {
          const at = entry.createdAt ? +new Date(entry.createdAt) : 0;
          return at > from && at <= from + bucketMs;
        });
        return countEvent(bucket, 'upload.complete') / (bucketHours || 1);
      });
      return delta === undefined ? { value, spark } : { value, delta, spark };
    },
  };
}

/** Recent completed uploads (newest first). [new-events] */
export function mediaRecentUploadsProvider(): DataProvider {
  return {
    name: 'media.recentUploads',
    async resolve(query, ctx) {
      const limit = Math.min(200, Math.max(10, Number(query?.limit ?? 50)));
      const rows = (await fetchMediaEntries(ctx))
        .filter((entry) => eventOf(entry).event === 'upload.complete')
        .sort((a, b) => (b.createdAt ? +new Date(b.createdAt) : 0) - (a.createdAt ? +new Date(a.createdAt) : 0))
        .slice(0, limit)
        .map((entry) => {
          const content = eventOf(entry);
          return {
            id: content.id ?? '',
            disk: content.disk ?? '',
            key: content.key ?? '',
            size: content.size ?? 0,
          };
        });
      return { rows };
    },
  };
}

/** Storage-writing over time — `attach` event volume. [new-events] */
export function mediaStorageWritesOverTimeProvider(): DataProvider {
  return {
    name: 'media.storageWritesOverTime',
    async resolve(query, ctx) {
      const entries = await fetchMediaEntries(ctx);
      const buckets = Number(query?.buckets ?? 24);
      const { rows, minTime, bucketSize } = timeBuckets(entries, buckets, () => ({ attach: 0 }));
      for (const entry of entries) {
        if (eventOf(entry).event !== 'attach') continue;
        const row = rows[bucketIndexFor(entry, minTime, bucketSize, buckets)];
        if (row) row.attach += 1;
      }
      return { rows };
    },
  };
}

/**
 * Attachment create/delete activity over time. [new-events]
 *
 * CAVEAT: attachments (the column-model embed) have no inventory table — the events are
 * the ONLY signal — so this panel shows create/delete RATES, never a current count.
 */
export function mediaAttachmentActivityProvider(): DataProvider {
  return {
    name: 'media.attachmentActivity',
    async resolve(query, ctx) {
      const entries = await fetchMediaEntries(ctx);
      const buckets = Number(query?.buckets ?? 24);
      const { rows, minTime, bucketSize } = timeBuckets(entries, buckets, () => ({
        created: 0,
        deleted: 0,
      }));
      for (const entry of entries) {
        const event = eventOf(entry).event;
        if (event !== 'attachment.create' && event !== 'attachment.delete') continue;
        const row = rows[bucketIndexFor(entry, minTime, bucketSize, buckets)];
        if (!row) continue;
        if (event === 'attachment.create') row.created += 1;
        else row.deleted += 1;
      }
      return { rows };
    },
  };
}

// ─── Media library (MEDIA_STORE token) ─────────────────────────────────────────

function getStore(ctx: ExtensionContext): MediaStore | null {
  return ctx.moduleRef.get<MediaStore | null>(MEDIA_STORE, { strict: false });
}

/** Total media (metric:'count') or total bytes (metric:'bytes'). [new-store] — 0 when store null or count/aggregate omitted. */
export function mediaLibraryTotalsProvider(): DataProvider {
  return {
    name: 'media.libraryTotals',
    async resolve(query, ctx) {
      const store = getStore(ctx);
      if (!store) return { value: 0 };
      if (query?.metric === 'bytes') {
        if (typeof store.aggregate !== 'function') return { value: 0 };
        const byDisk = await store.aggregate({ groupBy: 'disk', sum: 'size' });
        return { value: byDisk.reduce((total, bucket) => total + bucket.sumSize, 0) };
      }
      if (typeof store.count !== 'function') return { value: 0 };
      return { value: await store.count() };
    },
  };
}

/** Media by collection donut. [new-store] — empty segments when store null or aggregate omitted. */
export function mediaByCollectionProvider(): DataProvider {
  return {
    name: 'media.byCollection',
    async resolve(_query, ctx) {
      const store = getStore(ctx);
      if (!store || typeof store.aggregate !== 'function') return { segments: [] };
      const buckets = await store.aggregate({ groupBy: 'collection', sum: 'size' });
      return { segments: buckets.map((bucket) => ({ label: bucket.key, value: bucket.count })) };
    },
  };
}

/** Storage by disk bar (summed bytes). [new-store] — empty segments when store null or aggregate omitted. */
export function mediaStorageByDiskProvider(): DataProvider {
  return {
    name: 'media.storageByDisk',
    async resolve(_query, ctx) {
      const store = getStore(ctx);
      if (!store || typeof store.aggregate !== 'function') return { segments: [] };
      const buckets = await store.aggregate({ groupBy: 'disk', sum: 'size' });
      return { segments: buckets.map((bucket) => ({ label: bucket.key, value: bucket.sumSize })) };
    },
  };
}

// ─── Disks & config (MEDIA_STORAGE_SHARED token) ───────────────────────────────

/** Configured disks + capability badges. [live] — empty rows when the manager isn't reachable. */
export function mediaDisksProvider(): DataProvider {
  return {
    name: 'media.disks',
    async resolve(_query, ctx) {
      const manager = ctx.moduleRef.get<StorageManager | null>(MEDIA_STORAGE_SHARED, {
        strict: false,
      });
      if (!manager) return { rows: [] };
      const rows = manager.diskNames().map((name) => {
        const capabilities = manager.disk(name).capabilities;
        return {
          name,
          default: name === manager.defaultDisk ? 'yes' : 'no',
          presign: capabilities.presign ? 'yes' : 'no',
          multipart: capabilities.multipart ? 'yes' : 'no',
          publicUrls: capabilities.publicUrls ? 'yes' : 'no',
          list: capabilities.list ? 'yes' : 'no',
        };
      });
      return { rows };
    },
  };
}
