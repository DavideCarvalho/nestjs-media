import { runMediaStoreConformance } from '@dudousxd/nestjs-media-testing';
import { MikroORM } from '@mikro-orm/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaEntity } from './media.entity';
import { MikroOrmMediaStore, ensureMediaSchema } from './mikro-orm-media-store';

const orms: MikroORM[] = [];

async function makeOrm(): Promise<MikroORM> {
  const orm = await MikroORM.init({
    dbName: ':memory:',
    entities: [MediaEntity],
    allowGlobalContext: true,
  });
  await ensureMediaSchema(orm);
  orms.push(orm);
  return orm;
}

afterEach(async () => {
  while (orms.length) await orms.pop()?.close(true);
});

runMediaStoreConformance('MikroOrmMediaStore (sqlite)', async () => {
  const orm = await makeOrm();
  return new MikroOrmMediaStore(orm.em);
});

describe('ensureMediaSchema (mikro-orm)', () => {
  it('creates the media table and is idempotent', async () => {
    const orm = await makeOrm();
    expect(await orm.schema.getUpdateSchemaSQL({ safe: true })).toBe('');
    await ensureMediaSchema(orm); // second run is a no-op
  });
});

describe('MikroOrmMediaStore on a table without tenant_id', () => {
  it('works with tenancy off, and enableTenancy fails with the fix until the column exists', async () => {
    const orm = await makeOrm();
    await orm.em.getConnection().execute('drop index idx_media_tenant');
    await orm.em.getConnection().execute('alter table media drop column tenant_id');
    const store = new MikroOrmMediaStore(orm.em);
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
    await store.save({ ...record, tenantId: 'ignored-while-off' });
    expect(await store.find('a')).toMatchObject({ id: 'a' });
    expect(await store.listByOwner('Post', '1')).toHaveLength(1);
    expect(await store.count()).toBe(1);
    expect(await store.aggregate({ groupBy: 'disk' })).toHaveLength(1);
    expect((await store.list()).records).toHaveLength(1);

    await expect(store.enableTenancy()).rejects.toMatchObject({
      name: 'MediaTenancyUnavailableError',
      message: expect.stringContaining('ensureMediaSchema(orm)'),
    });

    await ensureMediaSchema(orm);
    await store.enableTenancy();
    expect((await store.find('a'))?.tenantId).toBeNull();
  });
});
