// Integration: DrizzlePgMediaStore (`@dudousxd/nestjs-media-database-drizzle/pg`) against real
// Postgres. Uses MEDIA_PG_URL when set (isolated schema, dropped afterwards), else testcontainers.
// Excluded from the default run; use `pnpm test:db`.
import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzlePgMediaStore, mediaPgTable } from './pg';
import {
  type PgTestDatabase,
  skipPgSpecs,
  startPgTestDatabase,
} from './test-support/pg-test-database';

describe.skipIf(skipPgSpecs)('DrizzlePgMediaStore (postgres)', () => {
  let pgdb: PgTestDatabase;

  beforeAll(async () => {
    pgdb = await startPgTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await pgdb?.teardown();
  });

  // Shared store across tests; truncate between cases for isolation.
  runMediaStoreConformance('DrizzlePgMediaStore (postgres)', async () => {
    await pgdb.db.execute(sql`TRUNCATE TABLE media`);
    return new DrizzlePgMediaStore(pgdb.db);
  });

  it('createMediaPgTables DDL matches the mediaPgTable columns', async () => {
    const { rows } = await pgdb.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'media'`,
      [pgdb.schema],
    );
    const ddlColumns = rows.map((row) => row.column_name).sort();
    const tableColumns = getTableConfig(mediaPgTable)
      .columns.map((column) => column.name)
      .sort();
    expect(ddlColumns).toEqual(tableColumns);
  });

  it('round-trips bigint size, jsonb and timestamptz as JS types', async () => {
    await pgdb.db.execute(sql`TRUNCATE TABLE media`);
    const store = new DrizzlePgMediaStore(pgdb.db);
    const createdAt = new Date('2026-01-02T03:04:05.678Z');
    await store.save({
      id: 'big',
      ownerType: 'Post',
      ownerId: '1',
      collection: 'c',
      name: 'n',
      fileName: 'n.bin',
      mimeType: 'application/octet-stream',
      size: 5_000_000_000,
      disk: 'local',
      path: 'p',
      order: 0,
      customProperties: { nested: { a: [1, 2] } },
      conversions: { thumb: { path: 'p/thumb', disk: 'local' } },
      createdAt,
      updatedAt: createdAt,
    });
    const found = await store.find('big');
    expect(found?.size).toBe(5_000_000_000);
    expect(found?.customProperties).toEqual({ nested: { a: [1, 2] } });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.createdAt.getTime()).toBe(createdAt.getTime());
    const [agg] = await store.aggregate({ groupBy: 'disk', sum: 'size' });
    expect(agg).toEqual({ key: 'local', count: 1, sumSize: 5_000_000_000 });
  });
});
