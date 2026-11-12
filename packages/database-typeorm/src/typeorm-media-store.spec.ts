import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { DataSource, EntityManager } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('TypeOrmMediaStore tenancy schema', () => {
  const record = {
    id: 'a',
    ownerType: 'Post',
    ownerId: '1',
    collection: 'gallery',
    name: 'a',
    fileName: 'a.txt',
    mimeType: 'text/plain',
    size: 1,
    disk: 'local',
    path: 'p',
    order: 0,
    customProperties: {},
    conversions: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  async function legacyTable(ds: DataSource): Promise<void> {
    await ds.query(`CREATE TABLE media (
      id varchar PRIMARY KEY NOT NULL, ownerType varchar NOT NULL, ownerId varchar NOT NULL,
      collection varchar NOT NULL, name varchar NOT NULL, fileName varchar NOT NULL,
      mimeType varchar NOT NULL, size integer NOT NULL, disk varchar NOT NULL, path varchar NOT NULL,
      position integer NOT NULL, customProperties text NOT NULL, conversions text NOT NULL,
      createdAt varchar NOT NULL, updatedAt varchar NOT NULL
    )`);
  }

  it('with tenancy off, never adds or touches tenant_id on an existing table', async () => {
    const ds = await makeDataSource();
    await legacyTable(ds);
    const store = new TypeOrmMediaStore(ds);
    await store.save({ ...record, tenantId: 'ignored-while-off' });
    expect(await store.find('a')).toMatchObject({ id: 'a' });
    expect(await store.listByOwner('Post', '1')).toHaveLength(1);
    expect(await store.count()).toBe(1);
    expect((await store.list()).records).toHaveLength(1);
    const qr = ds.createQueryRunner();
    expect(await qr.hasColumn('media', 'tenant_id')).toBe(false);
    await qr.release();
  });

  it('enableTenancy adds the column and index under autoCreateSchema', async () => {
    const ds = await makeDataSource();
    await legacyTable(ds);
    const store = new TypeOrmMediaStore(ds);
    await store.save(record);
    await store.enableTenancy();
    const qr = ds.createQueryRunner();
    expect(await qr.hasColumn('media', 'tenant_id')).toBe(true);
    expect((await qr.getTable('media'))?.indices.map((i) => i.name)).toContain('idx_media_tenant');
    await qr.release();
    expect((await store.find('a'))?.tenantId).toBeNull();
    await store.save({ ...record, tenantId: 'org_1' });
    expect((await store.find('a'))?.tenantId).toBe('org_1');
  });

  it('writes the row and its tenant atomically: a failed tenant write leaves nothing behind', async () => {
    const ds = await makeDataSource();
    const store = new TypeOrmMediaStore(ds);
    await store.enableTenancy();
    await store.save({ ...record, tenantId: 'org_1' });

    const query = EntityManager.prototype.query;
    const failTenantWrite = vi.spyOn(EntityManager.prototype, 'query').mockImplementation(function (
      this: EntityManager,
      sql: string,
      parameters?: unknown[],
    ) {
      if (/SET\s+"?tenant_id"?/i.test(sql)) return Promise.reject(new Error('tenant write failed'));
      return query.call(this, sql, parameters);
    });
    try {
      // A new row: its insert is rolled back with the failed tenant write.
      await expect(store.save({ ...record, id: 'b', tenantId: 'org_1' })).rejects.toThrow(
        'tenant write failed',
      );
      // A move to another tenant: neither the row's fields nor its tenant change.
      await expect(store.save({ ...record, name: 'renamed', tenantId: 'org_2' })).rejects.toThrow(
        'tenant write failed',
      );
    } finally {
      failTenantWrite.mockRestore();
    }
    expect(await store.find('b')).toBeNull();
    expect(await store.find('a')).toMatchObject({ name: 'a', tenantId: 'org_1' });
  });

  it('enableTenancy fails with the fix when autoCreateSchema is off and the column is missing', async () => {
    const ds = await makeDataSource();
    await legacyTable(ds);
    const store = new TypeOrmMediaStore(ds, { autoCreateSchema: false });
    await expect(store.enableTenancy()).rejects.toMatchObject({
      name: 'MediaTenancyUnavailableError',
      message: expect.stringContaining('ALTER TABLE media ADD COLUMN tenant_id'),
    });
  });
});
