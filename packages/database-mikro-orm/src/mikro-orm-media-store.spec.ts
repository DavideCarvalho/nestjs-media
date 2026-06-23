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
