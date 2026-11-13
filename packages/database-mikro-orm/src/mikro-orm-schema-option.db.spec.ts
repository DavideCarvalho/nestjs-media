// Integration: the `schema` option of MikroOrmMediaStore on Postgres and MySQL. The connection keeps
// its default (`public`, or the `app` database); the media table lives in another schema/database,
// named in every statement. Excluded from the default run; use `pnpm test:db`.
import { randomBytes } from 'node:crypto';
import type { MediaRecord } from '@dudousxd/nestjs-media-core';
import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import type { MikroORM as CoreMikroORM } from '@mikro-orm/core';
import { MikroORM as MySqlORM } from '@mikro-orm/mysql';
import { MikroORM as PgORM } from '@mikro-orm/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaEntity } from './media.entity';
import { MikroOrmMediaStore, ensureMediaSchema } from './mikro-orm-media-store';

const SCHEMA = `media_s_${randomBytes(4).toString('hex')}`;

const record = (id: string, over: Partial<MediaRecord> = {}): MediaRecord => ({
  id,
  ownerType: 'Post',
  ownerId: '1',
  collection: 'c',
  name: id,
  fileName: `${id}.txt`,
  mimeType: 'text/plain',
  size: 1,
  disk: 'local',
  path: `p/${id}`,
  order: 0,
  customProperties: {},
  conversions: {},
  createdAt: new Date(1000),
  updatedAt: new Date(1000),
  ...over,
});

interface Dialect {
  name: string;
  defaultSchema: string;
  quote: (name: string) => string;
  start(): Promise<{ container: StartedTestContainer; orm: CoreMikroORM }>;
}

const dialects: Dialect[] = [
  {
    name: 'postgres',
    defaultSchema: 'public',
    quote: (name) => `"${name}"`,
    async start() {
      const container = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'media' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .start();
      const orm = await PgORM.init({
        host: container.getHost(),
        port: container.getMappedPort(5432),
        user: 'postgres',
        password: 'test',
        dbName: 'media',
        entities: [mediaEntity({ schema: SCHEMA })],
        allowGlobalContext: true,
      });
      return { container, orm: orm as unknown as CoreMikroORM };
    },
  },
  {
    name: 'mysql',
    defaultSchema: 'app',
    quote: (name) => `\`${name}\``,
    async start() {
      const container = await new GenericContainer('mysql:8.0')
        .withEnvironment({ MYSQL_ROOT_PASSWORD: 'test', MYSQL_DATABASE: 'app' })
        .withExposedPorts(3306)
        .withWaitStrategy(Wait.forLogMessage(/port: 3306 {2}MySQL Community Server/))
        .withStartupTimeout(180_000)
        .start();
      const orm = await MySqlORM.init({
        host: container.getHost(),
        port: container.getMappedPort(3306),
        user: 'root',
        password: 'test',
        dbName: 'app',
        entities: [mediaEntity({ schema: SCHEMA })],
        allowGlobalContext: true,
      });
      return { container, orm: orm as unknown as CoreMikroORM };
    },
  },
];

for (const dialect of dialects) {
  describe(`MikroOrmMediaStore with \`schema\` (${dialect.name})`, () => {
    let container: StartedTestContainer;
    let orm: CoreMikroORM;
    const table = () => `${dialect.quote(SCHEMA)}.${dialect.quote('media')}`;
    const tablesIn = async (schema: string) =>
      (
        await orm.em
          .getConnection()
          .execute<{ name: string }[]>(
            `select table_name as name from information_schema.tables where table_schema = ? and table_name like 'media%'`,
            [schema],
          )
      ).map((row: { name: string }) => row.name);

    beforeAll(async () => {
      const started = await dialect.start();
      container = started.container;
      orm = started.orm;
      // The schema doesn't exist yet: the heal creates it. A second run is a no-op.
      await ensureMediaSchema(orm, { schema: SCHEMA });
      await ensureMediaSchema(orm, { schema: SCHEMA });
    }, 240_000);

    afterAll(async () => {
      await orm?.close(true);
      await container?.stop();
    });

    it('creates the table in the schema, and nothing in the default one', async () => {
      expect(await tablesIn(SCHEMA)).toEqual(['media']);
      expect(await tablesIn(dialect.defaultSchema)).toEqual([]);
    });

    runMediaStoreConformance(`MikroOrmMediaStore (${dialect.name}, schema)`, async () => {
      await orm.em.getConnection().execute(`truncate table ${table()}`);
      return new MikroOrmMediaStore(orm.em, { schema: SCHEMA });
    });

    it('tenancy: the column probe, the filters and the raw aggregate stay in the schema', async () => {
      await orm.em.getConnection().execute(`truncate table ${table()}`);
      const store = new MikroOrmMediaStore(orm.em, { schema: SCHEMA });
      await store.enableTenancy();
      await store.save(record('a', { tenantId: 't1' }));
      await store.save(record('b', { tenantId: 't2' }));
      expect((await store.find('a'))?.tenantId).toBe('t1');
      expect((await store.list({ tenant: { id: 't1' } })).records.map((r) => r.id)).toEqual(['a']);
      expect(await store.count({ tenant: { id: 't2' } })).toBe(1);
      expect(await store.aggregate({ groupBy: 'collection', tenant: { id: 't1' } })).toEqual([
        { key: 'c', count: 1, sumSize: 0 },
      ]);
      expect(await tablesIn(dialect.defaultSchema)).toEqual([]);
    });

    it('works inside an app transaction', async () => {
      await orm.em.transactional(async (em) => {
        const store = new MikroOrmMediaStore(em, { schema: SCHEMA });
        await store.save(record('tx1'));
      });
      const rows = await orm.em
        .getConnection()
        .execute<unknown[]>(`select id from ${table()} where id = 'tx1'`);
      expect(rows).toHaveLength(1);
    });
  });
}
