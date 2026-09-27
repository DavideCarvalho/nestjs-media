// Shared bootstrap for the `/pg` db specs (not part of the published entry points).
//
// When `MEDIA_PG_URL` is set, the specs run against that existing database: each spec file creates
// its own uniquely-named schema (via `search_path`), and drops it on teardown — nothing outside
// that schema is touched. Otherwise a testcontainers `postgres:16-alpine` is started, matching the
// repo's other `*.db.spec.ts`. `SKIP_TESTCONTAINERS=1` (without `MEDIA_PG_URL`) skips cleanly.
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { DrizzlePgDatabase } from '../pg/db';
import { createMediaPgTables } from '../pg/ddl';

export const externalPgUrl = process.env.MEDIA_PG_URL;
export const skipPgSpecs = !externalPgUrl && !!process.env.SKIP_TESTCONTAINERS;

export interface PgTestDatabase {
  db: DrizzlePgDatabase;
  pool: pg.Pool;
  schema: string;
  teardown(): Promise<void>;
}

export async function startPgTestDatabase(): Promise<PgTestDatabase> {
  let container: StartedTestContainer | undefined;
  let url = externalPgUrl;
  if (!url) {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'media' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    url = `postgres://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/media`;
  }

  const schema = `media_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  const pool = new pg.Pool({
    connectionString: url,
    max: 20,
    options: `-c search_path=${schema}`,
  });
  const db = drizzle(pool) as DrizzlePgDatabase;
  await createMediaPgTables(db);

  return {
    db,
    pool,
    schema,
    async teardown() {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await pool.end();
        await container?.stop();
      }
    },
  };
}
