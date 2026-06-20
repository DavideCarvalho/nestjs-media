import { Attachment } from '@dudousxd/nestjs-media-core';
import { EntitySchema, MikroORM } from '@mikro-orm/better-sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AttachmentType } from './attachment.type';

interface UserRow {
  id: string;
  avatar: Attachment | null;
}

const UserEntity = new EntitySchema<UserRow>({
  class: class User {} as { new (): UserRow },
  tableName: 'app_user',
  properties: {
    id: { type: 'string', primary: true },
    avatar: { type: AttachmentType, nullable: true },
  },
});

const orms: MikroORM[] = [];
afterEach(async () => {
  while (orms.length) await orms.pop()?.close(true);
});

async function makeOrm(): Promise<MikroORM> {
  const orm = await MikroORM.init({
    dbName: ':memory:',
    entities: [UserEntity],
    allowGlobalContext: true,
  });
  await orm.schema.updateSchema({ safe: true });
  orms.push(orm);
  return orm;
}

describe('AttachmentType (mikro-orm)', () => {
  it('round-trips an Attachment through a JSON property', async () => {
    const orm = await makeOrm();
    const avatar = new Attachment({
      name: 'me.png',
      disk: 's3',
      path: 'a/me.png',
      size: 9,
      mimeType: 'image/png',
      variants: {
        thumb: { disk: 's3', path: 'a/variants/thumb.webp', size: 3, mimeType: 'image/webp' },
      },
      meta: {},
    });

    const em1 = orm.em.fork();
    em1.create(UserEntity, { id: 'u1', avatar });
    await em1.flush();

    const em2 = orm.em.fork();
    const loaded = await em2.findOneOrFail(UserEntity, { id: 'u1' });
    expect(loaded.avatar).toBeInstanceOf(Attachment);
    expect(loaded.avatar?.path).toBe('a/me.png');
    expect(loaded.avatar?.variants.thumb?.path).toBe('a/variants/thumb.webp');
  });
});
