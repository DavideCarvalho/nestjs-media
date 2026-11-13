// Integration: the `schema` option of the Drizzle Postgres stores. The connection keeps its default
// `search_path` (`public`); the media tables live in another schema, named in every statement.
// Excluded from the default run; use `pnpm test:db`.
import { randomBytes } from 'node:crypto';
import type { UploadSession } from '@dudousxd/nestjs-media-core';
import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type DrizzlePgDatabase,
  DrizzlePgMediaStore,
  DrizzlePgUploadSessionStore,
  createMediaPgTables,
} from './pg';
import { skipPgSpecs, startPgServer } from './test-support/pg-test-database';

const SCHEMA = `media_s_${randomBytes(4).toString('hex')}`;

const session = (id: string, over: Partial<UploadSession> = {}): UploadSession => ({
  id,
  disk: 's3',
  key: `k/${id}`,
  contentType: undefined,
  size: 30,
  offset: 0,
  parts: 0,
  ...over,
});

describe.skipIf(skipPgSpecs)('Drizzle Postgres stores with `schema`', () => {
  let server: Awaited<ReturnType<typeof startPgServer>>;
  let pool: pg.Pool;
  let db: DrizzlePgDatabase;

  /** The media tables in a schema, from the catalog. */
  const tablesIn = async (schema: string) =>
    (
      await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_name LIKE 'media%' ORDER BY table_name`,
        [schema],
      )
    ).rows.map((row) => row.table_name);

  beforeAll(async () => {
    server = await startPgServer();
    pool = new pg.Pool({ connectionString: server.url, max: 10 });
    db = drizzle(pool) as DrizzlePgDatabase;
    // The schema doesn't exist yet: the helper creates it. A second run is a no-op.
    await createMediaPgTables(db, { schema: SCHEMA });
    await createMediaPgTables(db, { schema: SCHEMA });
  }, 180_000);

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await pool?.end();
    await server?.stop();
  });

  it('creates every table in the schema, and none in public', async () => {
    expect(await tablesIn(SCHEMA)).toEqual([
      'media',
      'media_upload_parts',
      'media_upload_sessions',
    ]);
    expect(await tablesIn('public')).toEqual([]);
    const { rows } = await pool.query<{ schemaname: string }>(
      `SELECT DISTINCT schemaname FROM pg_indexes WHERE indexname LIKE 'idx_media%'`,
    );
    expect(rows.map((row) => row.schemaname)).toEqual([SCHEMA]);
  });

  runMediaStoreConformance('DrizzlePgMediaStore (postgres, schema)', async () => {
    await db.execute(sql.raw(`TRUNCATE TABLE "${SCHEMA}"."media"`));
    return new DrizzlePgMediaStore(db, { schema: SCHEMA });
  });

  it('the upload session store reads and writes in the schema, tenancy included', async () => {
    const store = new DrizzlePgUploadSessionStore(db, { schema: SCHEMA });
    await store.enableTenancy();
    await store.create(session('u1', { tenantId: 't1' }));
    await store.addPart?.('u1', { partNumber: 2, etag: 'b' });
    await store.addPart?.('u1', { partNumber: 1, etag: 'a' });
    await store.update(session('u1', { offset: 10, tenantId: 't1' }));
    expect((await store.get('u1'))?.offset).toBe(10);
    expect((await store.listParts?.('u1'))?.map((p) => p.etag)).toEqual(['a', 'b']);
    expect((await store.list?.({ tenant: { id: 't1' } }))?.map((s) => s.id)).toEqual(['u1']);
    await store.delete('u1');
    expect(await store.get('u1')).toBeNull();
    const { rows } = await pool.query(`SELECT 1 FROM "${SCHEMA}"."media_upload_parts"`);
    expect(rows).toHaveLength(0); // the FK cascade stays inside the schema
  });

  it('works inside an app transaction', async () => {
    await db.transaction(async (tx) => {
      const store = new DrizzlePgMediaStore(tx as unknown as DrizzlePgDatabase, { schema: SCHEMA });
      await store.save({
        id: 'tx1',
        ownerType: 'Post',
        ownerId: '1',
        collection: 'c',
        name: 'n',
        fileName: 'n.txt',
        mimeType: 'text/plain',
        size: 1,
        disk: 'local',
        path: 'p',
        order: 0,
        customProperties: {},
        conversions: {},
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
      expect((await store.find('tx1'))?.id).toBe('tx1');
    });
    const { rows } = await pool.query(`SELECT id FROM "${SCHEMA}"."media" WHERE id = 'tx1'`);
    expect(rows).toHaveLength(1);
  });

  it('a role that cannot create the schema gets the grant it needs', async () => {
    await pool.query('DROP ROLE IF EXISTS media_nocreate');
    await pool.query(`CREATE ROLE media_nocreate LOGIN PASSWORD 'x'`);
    const url = new URL(server.url);
    url.username = 'media_nocreate';
    url.password = 'x';
    const limited = new pg.Pool({ connectionString: url.toString(), max: 1 });
    try {
      await expect(
        createMediaPgTables(drizzle(limited) as DrizzlePgDatabase, { schema: 'media_denied' }),
      ).rejects.toThrow(/could not create the schema "media_denied".*GRANT CREATE ON DATABASE/s);
    } finally {
      await limited.end();
      await pool.query('DROP ROLE IF EXISTS media_nocreate');
    }
  });
});
