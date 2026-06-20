import { InMemoryDriver } from '@dudousxd/nestjs-media-testing';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
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
});
