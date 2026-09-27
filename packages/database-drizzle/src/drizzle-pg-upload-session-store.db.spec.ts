// Integration: DrizzlePgUploadSessionStore (`@dudousxd/nestjs-media-database-drizzle/pg`) against
// real Postgres. Uses MEDIA_PG_URL when set (isolated schema, dropped afterwards), else
// testcontainers. Excluded from the default run; use `pnpm test:db`.
import type { UploadSession } from '@dudousxd/nestjs-media-core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzlePgUploadSessionStore } from './pg';
import {
  type PgTestDatabase,
  skipPgSpecs,
  startPgTestDatabase,
} from './test-support/pg-test-database';

function session(id: string, over: Partial<UploadSession> = {}): UploadSession {
  return {
    id,
    disk: 's3',
    key: `k/${id}`,
    contentType: undefined,
    size: 30,
    offset: 0,
    parts: 0,
    ...over,
  };
}

const byPart = (a: { partNumber: number }, b: { partNumber: number }) =>
  a.partNumber - b.partNumber;

describe.skipIf(skipPgSpecs)('DrizzlePgUploadSessionStore (postgres)', () => {
  let pgdb: PgTestDatabase;
  let store: DrizzlePgUploadSessionStore;

  beforeAll(async () => {
    pgdb = await startPgTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await pgdb?.teardown();
  });

  beforeEach(async () => {
    await pgdb.db.execute(sql`TRUNCATE TABLE media_upload_sessions CASCADE`);
    store = new DrizzlePgUploadSessionStore(pgdb.db);
  });

  it('create/get/update/delete round trip with JS numbers and a Date createdAt', async () => {
    const before = Date.now();
    const created = await store.create(session('a', { size: 5_000_000_000 }));
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.createdAt?.getTime()).toBeGreaterThanOrEqual(before);

    const fetched = await store.get('a');
    expect(fetched).toEqual({
      id: 'a',
      disk: 's3',
      key: 'k/a',
      contentType: undefined,
      size: 5_000_000_000,
      offset: 0,
      parts: 0,
      createdAt: created.createdAt,
    });
    expect(typeof fetched?.size).toBe('number');
    expect(typeof fetched?.offset).toBe('number');
    expect(typeof fetched?.parts).toBe('number');
    // Null optional columns are omitted, like the in-memory store.
    expect(fetched && 'metadata' in fetched).toBe(false);
    expect(fetched && 'multipartUploadId' in fetched).toBe(false);

    const updated = await store.update({
      ...(fetched as UploadSession),
      offset: 4_294_967_296,
      parts: 2,
      contentType: 'video/mp4',
      multipartUploadId: 'mpu-1',
      metadata: { recordId: 'r1', nested: { n: 1 } },
    });
    expect(updated.offset).toBe(4_294_967_296);

    const again = await store.get('a');
    expect(again).toEqual({
      id: 'a',
      disk: 's3',
      key: 'k/a',
      contentType: 'video/mp4',
      size: 5_000_000_000,
      offset: 4_294_967_296,
      parts: 2,
      multipartUploadId: 'mpu-1',
      metadata: { recordId: 'r1', nested: { n: 1 } },
      createdAt: created.createdAt,
    });

    await store.delete('a');
    expect(await store.get('a')).toBeNull();
  });

  it('get returns null for an unknown id; size may be unknown', async () => {
    expect(await store.get('missing')).toBeNull();
    await store.create(session('u', { size: undefined }));
    const fetched = await store.get('u');
    expect(fetched?.size).toBeUndefined();
    expect(fetched && 'size' in fetched).toBe(true);
  });

  it('addPart is atomic under concurrency (50 parallel parts → 50 rows)', async () => {
    await store.create(session('p'));
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        store.addPart('p', { partNumber: i + 1, etag: `e${i + 1}` }),
      ),
    );
    const parts = await store.listParts('p');
    expect(parts).toHaveLength(50);
    expect([...parts].sort(byPart)).toEqual(
      Array.from({ length: 50 }, (_, i) => ({ partNumber: i + 1, etag: `e${i + 1}` })),
    );
  });

  it('addPart overwrites the same partNumber (one row, last etag wins)', async () => {
    await store.create(session('o'));
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.addPart('o', { partNumber: 7, etag: `race${i}` })),
    );
    expect(await store.listParts('o')).toHaveLength(1);
    await store.addPart('o', { partNumber: 7, etag: 'final' });
    expect(await store.listParts('o')).toEqual([{ partNumber: 7, etag: 'final' }]);
  });

  it('records parts by number and lists them; delete cascades parts', async () => {
    await store.create(session('a'));
    await store.create(session('b'));
    await store.addPart('a', { partNumber: 2, etag: 'e2' });
    await store.addPart('a', { partNumber: 1, etag: 'e1' });
    await store.addPart('b', { partNumber: 1, etag: 'b1' });
    expect([...(await store.listParts('a'))].sort(byPart)).toEqual([
      { partNumber: 1, etag: 'e1' },
      { partNumber: 2, etag: 'e2' },
    ]);
    await store.delete('a');
    expect(await store.listParts('a')).toEqual([]);
    const { rows } = await pgdb.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM media_upload_parts',
    );
    expect(Number(rows[0]?.n)).toBe(1);
    expect(await store.listParts('b')).toEqual([{ partNumber: 1, etag: 'b1' }]);
  });

  it('list() returns all sessions; list({ disk }) filters by disk', async () => {
    await store.create({ ...session('a'), disk: 'local' });
    await store.create({ ...session('b'), disk: 'files' });
    const all = await store.list();
    expect(all.map((s) => s.id).sort()).toEqual(['a', 'b']);
    for (const s of all) expect(s.createdAt).toBeInstanceOf(Date);
    expect((await store.list({ disk: 'files' })).map((s) => s.id)).toEqual(['b']);
  });

  it('list({ disk, keyPrefix }) filters by disk and key prefix', async () => {
    await store.create({ ...session('a'), disk: 'files', key: 'reports/2026/a' });
    await store.create({ ...session('b'), disk: 'files', key: 'other/b' });
    await store.create({ ...session('c'), disk: 'local', key: 'reports/2026/c' });
    const scoped = await store.list({ disk: 'files', keyPrefix: 'reports/2026/' });
    expect(scoped.map((s) => s.id)).toEqual(['a']);
  });

  it('keyPrefix treats LIKE wildcards (% _ \\) literally', async () => {
    await store.create({ ...session('pct'), key: '100%/a' });
    await store.create({ ...session('pctx'), key: '100x/a' });
    await store.create({ ...session('us'), key: 'a_b/c' });
    await store.create({ ...session('usx'), key: 'aXb/c' });
    await store.create({ ...session('bs'), key: 'back\\slash/c' });
    await store.create({ ...session('bsx'), key: 'backXslash/c' });
    expect((await store.list({ keyPrefix: '100%' })).map((s) => s.id)).toEqual(['pct']);
    expect((await store.list({ keyPrefix: 'a_b' })).map((s) => s.id)).toEqual(['us']);
    expect((await store.list({ keyPrefix: 'back\\' })).map((s) => s.id)).toEqual(['bs']);
    expect((await store.list({ keyPrefix: '%' })).map((s) => s.id)).toEqual([]);
  });
});
