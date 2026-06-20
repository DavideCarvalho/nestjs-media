import { InMemoryDriver, InMemoryMediaStore } from '@dudousxd/nestjs-media-testing';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MediaModule } from './media.module';
import { MediaService } from './media.service';

describe('MediaModule (media-library layer)', () => {
  it('exposes a working MediaLibrary when a store is configured', async () => {
    const disk = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [
        MediaModule.forRoot({
          default: 'local',
          disks: { local: disk },
          store: new InMemoryMediaStore(),
          collections: [{ name: 'avatar', single: true }],
        }),
      ],
    }).compile();

    const media = mod.get(MediaService);
    const record = await media.library.attach({
      ownerType: 'User',
      ownerId: '1',
      collection: 'avatar',
      fileName: 'me.png',
      mimeType: 'image/png',
      contents: Buffer.from('avatar-bytes'),
    });

    expect(record.collection).toBe('avatar');
    expect((await disk.get(record.path)).toString()).toBe('avatar-bytes');
    expect(await media.library.list('User', '1', 'avatar')).toHaveLength(1);
  });

  it('throws a helpful error when the library is used without a store', async () => {
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRoot({ default: 'local', disks: { local: new InMemoryDriver() } })],
    }).compile();

    expect(() => mod.get(MediaService).library).toThrow(/MediaLibrary is not configured/);
  });
});
