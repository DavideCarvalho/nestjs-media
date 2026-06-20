// Integration: PrismaMediaStore against a REAL generated PrismaClient + Postgres
// (testcontainers). This is what validates the structural PrismaClientLike contract
// against reality — the fake-delegate unit test only covers the store's own mapping.
//
// The Prisma client is generated for ONE provider at a time, so this spec generates a
// Postgres client at test time (into the gitignored generated/pg-client) and `db push`es
// the schema. If Docker is unavailable or generate/push fails (e.g. offline engine
// download), every case skips cleanly — it never fails the suite. Excluded from the
// default run; use `pnpm test:db`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { MediaRecord } from '@dudousxd/nestjs-media-core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaMediaStore } from './prisma-media-store';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const CONTAINER_TIMEOUT = 180_000;

let pg: StartedPostgreSqlContainer | undefined;
let prisma: any;
let store: PrismaMediaStore | undefined;
let setupError: unknown;

function runPrisma(args: string[], url: string): void {
  execFileSync('npx', ['prisma', ...args], {
    cwd: pkgRoot,
    stdio: 'ignore',
    env: { ...process.env, PRISMA_PG_URL: url },
  });
}

beforeAll(async () => {
  try {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    const url = pg.getConnectionUri();
    const schema = 'prisma/test.pg.prisma';
    runPrisma(['generate', '--schema', schema], url);
    runPrisma(['db', 'push', '--schema', schema, '--skip-generate', '--accept-data-loss'], url);
    const { PrismaClient } = await import('../generated/pg-client/index.js');
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
    store = new PrismaMediaStore(prisma);
  } catch (err) {
    setupError = err;
  }
}, CONTAINER_TIMEOUT);

afterAll(async () => {
  await prisma?.$disconnect?.();
  await pg?.stop();
});

function record(over: Partial<MediaRecord> = {}): MediaRecord {
  const ts = new Date(0);
  return {
    id: 'a',
    ownerType: 'Post',
    ownerId: '1',
    collection: 'gallery',
    name: 'n',
    fileName: 'n.png',
    mimeType: 'image/png',
    size: 1,
    disk: 'local',
    path: 'p',
    order: 0,
    customProperties: {},
    conversions: {},
    createdAt: ts,
    updatedAt: ts,
    ...over,
  };
}

describe('PrismaMediaStore [real Postgres / testcontainers]', () => {
  it('reports setup errors (or skips when Docker is unavailable)', (ctx) => {
    if (!store) {
      ctx.skip();
      return;
    }
    expect(setupError).toBeUndefined();
  });

  it('saves, finds, lists (ordered + filtered), aggregates nextOrder, deletes', async (ctx) => {
    if (!store) {
      ctx.skip();
      return;
    }
    await prisma.media.deleteMany();

    await store.save(record({ id: 'a', collection: 'gallery', order: 1 }));
    await store.save(record({ id: 'b', collection: 'gallery', order: 0 }));
    await store.save(record({ id: 'c', collection: 'avatar', order: 0 }));

    expect((await store.find('a'))?.id).toBe('a');
    expect(await store.find('missing')).toBeNull();

    const gallery = await store.listByOwner('Post', '1', 'gallery');
    expect(gallery.map((r) => r.id)).toEqual(['b', 'a']);
    expect(await store.listByOwner('Post', '1')).toHaveLength(3);

    expect(await store.nextOrder('Post', '1', 'gallery')).toBe(2);
    expect(await store.nextOrder('Post', '1', 'empty')).toBe(0);

    await store.delete('a');
    expect(await store.find('a')).toBeNull();
    await store.delete('a'); // idempotent
  });

  it('upserts (save twice updates in place)', async (ctx) => {
    if (!store) {
      ctx.skip();
      return;
    }
    await prisma.media.deleteMany();
    await store.save(record({ id: 'x', name: 'first' }));
    await store.save(record({ id: 'x', name: 'second' }));
    const rows = await store.listByOwner('Post', '1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('second');
  });
});
