// Integration: the `schema` option of TypeOrmMediaStore on Postgres and MySQL. The connection keeps
// its default (`public`, or the `app` database); the media table lives in another schema/database,
// named in every statement. Excluded from the default run; use `pnpm test:db`.
import { randomBytes } from 'node:crypto';
import type { MediaRecord } from '@dudousxd/nestjs-media-core';
import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaEntity } from './media.entity';
import { TypeOrmMediaStore, ensureMediaSchema } from './typeorm-media-store';

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
  start(): Promise<{ container: StartedTestContainer; options: DataSourceOptions }>;
  /** The media tables in a schema/database, from the catalog. */
  tables(ds: DataSource, schema: string): Promise<string[]>;
  defaultSchema: string;
  truncate: string;
}

const dialects: Dialect[] = [
  {
    name: 'postgres',
    defaultSchema: 'public',
    truncate: `TRUNCATE TABLE "${SCHEMA}"."media"`,
    async start() {
      const container = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'media' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .start();
      return {
        container,
        options: {
          type: 'postgres',
          host: container.getHost(),
          port: container.getMappedPort(5432),
          username: 'postgres',
          password: 'test',
          database: 'media',
        },
      };
    },
    async tables(ds, schema) {
      const rows: { table_name: string }[] = await ds.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_name LIKE 'media%'`,
        [schema],
      );
      return rows.map((row) => row.table_name);
    },
  },
  {
    name: 'mysql',
    defaultSchema: 'app',
    truncate: `TRUNCATE TABLE \`${SCHEMA}\`.\`media\``,
    async start() {
      const container = await new GenericContainer('mysql:8.0')
        .withEnvironment({ MYSQL_ROOT_PASSWORD: 'test', MYSQL_DATABASE: 'app' })
        .withExposedPorts(3306)
        .withWaitStrategy(Wait.forLogMessage(/port: 3306 {2}MySQL Community Server/))
        .withStartupTimeout(180_000)
        .start();
      return {
        container,
        options: {
          type: 'mysql',
          host: container.getHost(),
          port: container.getMappedPort(3306),
          username: 'root',
          password: 'test',
          database: 'app',
        },
      };
    },
    async tables(ds, schema) {
      const rows: { name: string }[] = await ds.query(
        `SELECT table_name AS name FROM information_schema.tables
         WHERE table_schema = ? AND table_name LIKE 'media%'`,
        [schema],
      );
      return rows.map((row) => row.name);
    },
  },
];

for (const dialect of dialects) {
  describe(`TypeOrmMediaStore with \`schema\` (${dialect.name})`, () => {
    let container: StartedTestContainer;
    let dataSource: DataSource;

    beforeAll(async () => {
      const started = await dialect.start();
      container = started.container;
      dataSource = new DataSource({
        ...started.options,
        entities: [mediaEntity({ schema: SCHEMA })],
        synchronize: false,
      } as DataSourceOptions);
      await dataSource.initialize();
      // The schema doesn't exist yet: the heal creates it. A second run is a no-op.
      await ensureMediaSchema(dataSource, { schema: SCHEMA });
      await ensureMediaSchema(dataSource, { schema: SCHEMA, tenancy: true });
    }, 240_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) await dataSource.destroy();
      await container?.stop();
    });

    it('creates the table in the schema, and nothing in the default one', async () => {
      expect(await dialect.tables(dataSource, SCHEMA)).toEqual(['media']);
      expect(await dialect.tables(dataSource, dialect.defaultSchema)).toEqual([]);
    });

    runMediaStoreConformance(`TypeOrmMediaStore (${dialect.name}, schema)`, async () => {
      await dataSource.query(dialect.truncate);
      return new TypeOrmMediaStore(dataSource, { schema: SCHEMA, autoCreateSchema: false });
    });

    it('tenancy: the column check, the tenant UPDATE and the filters stay in the schema', async () => {
      await dataSource.query(dialect.truncate);
      const store = new TypeOrmMediaStore(dataSource, { schema: SCHEMA });
      await store.enableTenancy();
      await store.save(record('a', { tenantId: 't1' }));
      await store.save(record('b', { tenantId: 't2' }));
      expect((await store.find('a'))?.tenantId).toBe('t1');
      expect((await store.list({ tenant: { id: 't1' } })).records.map((r) => r.id)).toEqual(['a']);
      expect(await store.count({ tenant: { id: 't2' } })).toBe(1);
      expect(await store.aggregate({ groupBy: 'collection', tenant: { id: 't1' } })).toEqual([
        { key: 'c', count: 1, sumSize: 0 },
      ]);
      expect(await dialect.tables(dataSource, dialect.defaultSchema)).toEqual([]);
    });
  });
}
