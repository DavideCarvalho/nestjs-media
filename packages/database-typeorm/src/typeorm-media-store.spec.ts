import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaEntity } from './media.entity';
import { TypeOrmMediaStore, ensureMediaSchema } from './typeorm-media-store';

const sources: DataSource[] = [];

async function makeDataSource(): Promise<DataSource> {
  const ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [MediaEntity],
    synchronize: false,
  });
  await ds.initialize();
  sources.push(ds);
  return ds;
}

afterEach(async () => {
  while (sources.length) await sources.pop()?.destroy();
});

// The reference contract, run against a real TypeORM + SQLite store with the
// auto-created schema (no synchronize, no migrations).
runMediaStoreConformance('TypeOrmMediaStore (sqlite)', async () => {
  return new TypeOrmMediaStore(await makeDataSource());
});

describe('ensureMediaSchema', () => {
  it('creates the media table and is idempotent', async () => {
    const ds = await makeDataSource();
    const qr = ds.createQueryRunner();
    expect(await qr.hasTable('media')).toBe(false);
    await ensureMediaSchema(ds);
    expect(await qr.hasTable('media')).toBe(true);
    await ensureMediaSchema(ds); // second run must not throw
    expect(await qr.hasColumn('media', 'position')).toBe(true);
    await qr.release();
  });
});
