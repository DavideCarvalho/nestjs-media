// Integration: MikroOrmMediaStore + ensureMediaSchema against real Postgres
// (testcontainers). Excluded from the default run; use `pnpm test:db`.
import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { MikroORM } from '@mikro-orm/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll } from 'vitest';
import { MediaEntity } from './media.entity';
import { MikroOrmMediaStore, ensureMediaSchema } from './mikro-orm-media-store';

let container: StartedTestContainer;
let orm: MikroORM;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'media' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  orm = await MikroORM.init({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: 'postgres',
    password: 'test',
    dbName: 'media',
    entities: [MediaEntity],
    allowGlobalContext: true,
  });
  await ensureMediaSchema(orm);
}, 120_000);

afterAll(async () => {
  await orm?.close(true);
  await container?.stop();
});

runMediaStoreConformance('MikroOrmMediaStore (postgres)', async () => {
  await orm.em.getConnection().execute('TRUNCATE TABLE media');
  return new MikroOrmMediaStore(orm.em);
});
