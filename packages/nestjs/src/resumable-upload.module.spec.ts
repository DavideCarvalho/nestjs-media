import { InMemoryDriver, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MediaModule } from './media.module';
import { MediaService } from './media.service';

describe('MediaModule (resumable uploads)', () => {
  it('exposes a working ResumableUploadManager when sessions are configured', async () => {
    const disk = new InMemoryDriver();
    const mod = await Test.createTestingModule({
      imports: [
        MediaModule.forRoot({
          default: 'local',
          disks: { local: disk },
          uploadSessions: new InMemoryUploadSessionStore(),
        }),
      ],
    }).compile();

    const uploads = mod.get(MediaService).uploads;
    const session = await uploads.createUpload({ disk: 'local', key: 'big.bin' });
    await uploads.writeChunk(session.id, 0, Buffer.from('he'));
    await uploads.writeChunk(session.id, 2, Buffer.from('llo'));
    await uploads.complete(session.id);
    expect((await disk.get('big.bin')).toString()).toBe('hello');
  });

  it('throws a helpful error when uploads are not configured', async () => {
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRoot({ default: 'local', disks: { local: new InMemoryDriver() } })],
    }).compile();
    expect(() => mod.get(MediaService).uploads).toThrow(/Resumable uploads are not configured/);
  });
});
