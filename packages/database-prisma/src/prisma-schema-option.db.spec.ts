// Integration: PrismaMediaStore with the `Media` model in its own Postgres schema (Prisma's
// `@@schema`, see "Database schema" in the docs). The client is generated at test time from
// prisma/test.pg.schema.prisma into the gitignored generated/pg-schema-client; if Docker or the
// Prisma engines are unavailable, every case skips. Excluded from the default run; `pnpm test:db`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaMediaStore } from './prisma-media-store';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));

let pg: StartedPostgreSqlContainer | undefined;
let prisma: any;
let setupError: unknown;

beforeAll(async () => {
  try {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    const url = pg.getConnectionUri();
    const schema = 'prisma/test.pg.schema.prisma';
    const run = (args: string[]) =>
      execFileSync('npx', ['prisma', ...args], {
        cwd: pkgRoot,
        stdio: 'ignore',
        env: { ...process.env, PRISMA_PG_URL: url },
      });
    run(['generate', '--schema', schema]);
    run(['db', 'push', '--schema', schema, '--skip-generate', '--accept-data-loss']);
    const generatedClientPath = '../generated/pg-schema-client/index.js';
    const { PrismaClient } = await import(generatedClientPath);
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect?.();
  await pg?.stop();
});

describe('PrismaMediaStore with the model in its own schema [real Postgres]', () => {
  it('sets up (or skips when Docker or the engines are unavailable)', (ctx) => {
    if (!prisma) {
      ctx.skip();
      return;
    }
    expect(setupError).toBeUndefined();
  });

  it('keeps the table in the schema, and nothing in public', async (ctx) => {
    if (!prisma) {
      ctx.skip();
      return;
    }
    const rows: { table_schema: string }[] = await prisma.$queryRawUnsafe(
      `SELECT table_schema FROM information_schema.tables WHERE table_name = 'media'`,
    );
    expect(rows.map((row) => row.table_schema)).toEqual(['media_lib']);
  });
});

runMediaStoreConformance('PrismaMediaStore (postgres, @@schema)', async () => {
  if (!prisma) throw new Error(`Prisma setup failed: ${String(setupError)}`);
  await prisma.media.deleteMany();
  return new PrismaMediaStore(prisma);
});
