import { InMemoryDriver } from '@dudousxd/nestjs-media-testing';
import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MediaDirectUploadController } from './media-direct-upload.controller';
import { MediaUploadController } from './media-upload.controller';
import { MediaModule } from './media.module';
import { MediaService } from './media.service';

describe('MediaModule', () => {
  it('forRoot wires MediaService with the configured disks', async () => {
    const local = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRoot({ default: 'local', disks: { local } })],
    }).compile();

    const media = mod.get(MediaService);
    expect(media.disk()).toBe(local);
    await media.disk().put('hi.txt', Buffer.from('yo'));
    expect((await media.disk('local').get('hi.txt')).toString()).toBe('yo');
  });

  it('forRootAsync resolves options from a factory', async () => {
    const s3 = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRootAsync({ useFactory: () => ({ default: 's3', disks: { s3 } }) })],
    }).compile();

    expect(mod.get(MediaService).disk()).toBe(s3);
  });

  // forRootAsync cannot know at build time whether tus/direct are configured
  // (options resolve later via useFactory), so it always mounts both upload
  // controllers. When their feature is unconfigured the mounted handlers must
  // respond with a clear, uniform 501 NotImplemented rather than 404.
  it('forRootAsync mounts both upload controllers and they respond 501 when unconfigured', async () => {
    const local = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [
        MediaModule.forRootAsync({ useFactory: () => ({ default: 'local', disks: { local } }) }),
      ],
    }).compile();

    const tus = mod.get(MediaUploadController);
    const direct = mod.get(MediaDirectUploadController);
    expect(tus).toBeInstanceOf(MediaUploadController);
    expect(direct).toBeInstanceOf(MediaDirectUploadController);

    await expect(tus.create({ status: () => ({}) as never } as never, {})).rejects.toThrow(
      NotImplementedException,
    );
    expect(() => direct.initiate({ key: 'x' })).toThrow(NotImplementedException);
  });
});
