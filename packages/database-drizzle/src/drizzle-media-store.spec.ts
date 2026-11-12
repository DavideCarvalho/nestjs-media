import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DrizzleMediaStore, createMediaTable } from './drizzle-media-store';

runMediaStoreConformance('DrizzleMediaStore (sqlite)', () => {
  const db = drizzle(new Database(':memory:'));
  createMediaTable(db);
  return new DrizzleMediaStore(db);
});

const LEGACY_TABLE = `CREATE TABLE media (
  id text PRIMARY KEY NOT NULL, owner_type text NOT NULL, owner_id text NOT NULL,
  collection text NOT NULL, name text NOT NULL, file_name text NOT NULL, mime_type text NOT NULL,
  size integer NOT NULL, disk text NOT NULL, path text NOT NULL, position integer NOT NULL,
  custom_properties text NOT NULL, conversions text NOT NULL, created_at integer NOT NULL,
  updated_at integer NOT NULL
)`;

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

describe('DrizzleMediaStore on a table without tenant_id', () => {
  it('works with tenancy off, and enableTenancy fails with the fix until the column exists', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(LEGACY_TABLE);
    const db = drizzle(sqlite);
    const store = new DrizzleMediaStore(db);

    await store.save({ ...record, tenantId: 'ignored-while-off' });
    expect(await store.find('a')).toMatchObject({ id: 'a' });
    expect(await store.listByOwner('Post', '1')).toHaveLength(1);
    expect(await store.count()).toBe(1);
    expect(await store.aggregate({ groupBy: 'disk' })).toHaveLength(1);
    expect((await store.list()).records).toHaveLength(1);

    await expect(store.enableTenancy()).rejects.toMatchObject({
      name: 'MediaTenancyUnavailableError',
      message: expect.stringContaining('ALTER TABLE media ADD COLUMN tenant_id'),
    });

    createMediaTable(db); // adds the missing column to an existing table
    await store.enableTenancy();
    expect((await store.find('a'))?.tenantId).toBeNull();
  });
});
