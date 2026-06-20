import { Attachment } from '@dudousxd/nestjs-media-core';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';
import { attachmentTransformer } from './attachment.column';

interface UserRow {
  id: string;
  avatar: Attachment | null;
}

const UserEntity = new EntitySchema<UserRow>({
  name: 'user',
  tableName: 'app_user',
  columns: {
    id: { type: String, primary: true },
    avatar: { type: 'simple-json', nullable: true, transformer: attachmentTransformer },
  },
});

const sources: DataSource[] = [];
afterEach(async () => {
  while (sources.length) await sources.pop()?.destroy();
});

async function ds(): Promise<DataSource> {
  const d = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [UserEntity],
    synchronize: true,
  });
  await d.initialize();
  sources.push(d);
  return d;
}

describe('attachmentTransformer (typeorm column)', () => {
  it('round-trips an Attachment through a JSON column', async () => {
    const repo = (await ds()).getRepository(UserEntity);
    const avatar = new Attachment({
      name: 'me.png',
      disk: 's3',
      path: 'attachments/x/me.png',
      size: 12,
      mimeType: 'image/png',
      variants: {
        thumb: {
          disk: 's3',
          path: 'attachments/x/variants/thumb.webp',
          size: 3,
          mimeType: 'image/webp',
        },
      },
      meta: { alt: 'avatar' },
    });

    await repo.save({ id: 'u1', avatar });
    const loaded = await repo.findOneByOrFail({ id: 'u1' });

    expect(loaded.avatar).toBeInstanceOf(Attachment);
    expect(loaded.avatar?.path).toBe('attachments/x/me.png');
    expect(loaded.avatar?.variants.thumb?.path).toBe('attachments/x/variants/thumb.webp');
  });

  it('stores null for an absent attachment', async () => {
    const repo = (await ds()).getRepository(UserEntity);
    await repo.save({ id: 'u2', avatar: null });
    expect((await repo.findOneByOrFail({ id: 'u2' })).avatar).toBeNull();
  });
});
