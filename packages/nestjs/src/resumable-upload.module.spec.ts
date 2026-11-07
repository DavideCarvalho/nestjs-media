import { InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { InMemoryDisk, StorageModule } from '@nestjs/storage';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MediaModule } from './media.module';
import { MediaService } from './media.service';

describe('MediaModule (resumable uploads)', () => {
  it('exposes a working ResumableUploadManager when sessions are configured', async () => {
    const disk = new InMemoryDisk();
    const mod = await Test.createTestingModule({
      imports: [
        StorageModule.forRoot({ disks: { local: disk } }),
        MediaModule.forRoot({
          uploadSessions: new InMemoryUploadSessionStore(),
        }),
      ],
    }).compile();

    const uploads = mod.get(MediaService).uploads;
    const session = await uploads.createUpload({ disk: 'local', key: 'big.bin' });
    await uploads.writeChunk(session.id, 0, Buffer.from('he'));
    await uploads.writeChunk(session.id, 2, Buffer.from('llo'));
    await uploads.complete(session.id);
    expect(await disk.getText('big.bin')).toBe('hello');
  });

  it('throws a helpful error when uploads are not configured', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        StorageModule.forRoot({ disks: { local: new InMemoryDisk() } }),
        MediaModule.forRoot({}),
      ],
    }).compile();
    expect(() => mod.get(MediaService).uploads).toThrow(/Resumable uploads are not configured/);
  });
});
