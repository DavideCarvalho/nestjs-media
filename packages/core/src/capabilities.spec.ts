import { InMemoryDisk, S3Disk } from '@nestjs/storage';
import { describe, expect, it } from 'vitest';
import { diskCapabilities } from './capabilities';
import type { MultipartUploadDriver } from './types';

describe('diskCapabilities', () => {
  it('a bare in-memory disk can only list and read ranges', async () => {
    expect(await diskCapabilities(new InMemoryDisk())).toEqual({
      presign: false,
      multipart: false,
      publicUrls: false,
      list: true,
      ranged: true,
    });
  });

  it('signedUrls and publicUrl turn presign and publicUrls on', async () => {
    const disk = new InMemoryDisk({
      publicUrl: 'https://cdn.example.com',
      signedUrls: { baseUrl: 'https://api.example.com/files', keys: ['k'.repeat(32)] },
    });
    const caps = await diskCapabilities(disk);
    expect(caps.presign).toBe(true);
    expect(caps.publicUrls).toBe(true);
  });

  it('S3 presigns; a side-car adds multipart', async () => {
    const disk = new S3Disk({
      bucket: 'media-bucket',
      region: 'us-east-1',
      credentials: { accessKeyId: 'a', secretAccessKey: 's' },
    });
    const caps = await diskCapabilities(disk, {} as MultipartUploadDriver);
    expect(caps.presign).toBe(true);
    expect(caps.multipart).toBe(true);
    expect(caps.publicUrls).toBe(false);
  });
});
