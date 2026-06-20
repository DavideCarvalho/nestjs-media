// Integration: TypeOrmMediaStore + ensureMediaSchema against real Postgres
// (testcontainers). Validates the hand-written auto-schema on a non-sqlite dialect
// — the §3.10 risk point. Excluded from the default run; use `pnpm test:db`.
import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll } from 'vitest';
import { MediaEntity } from './media.entity';
import { TypeOrmMediaStore, ensureMediaSchema } from './typeorm-media-store';

let container: StartedTestContainer;
let dataSource: DataSource;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'media' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  dataSource = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getMappedPort(5432),
    username: 'postgres',
    password: 'test',
    database: 'media',
    entities: [MediaEntity],
    synchronize: false,
  });
  await dataSource.initialize();
  await ensureMediaSchema(dataSource);
}, 120_000);

afterAll(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
  await container?.stop();
});

// Shared store across tests on one container; truncate between cases for isolation.
runMediaStoreConformance('TypeOrmMediaStore (postgres)', async () => {
  await dataSource.query('TRUNCATE TABLE media');
  return new TypeOrmMediaStore(dataSource, { autoCreateSchema: false });
});
