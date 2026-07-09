import type {
  MediaListResult,
  MediaStore,
  StorageManager,
  UploadSession,
  UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
import { describe, expect, it } from 'vitest';
import { MediaConsoleService } from './media-console.service.js';

function fakeStorage(): StorageManager {
  const driver = {
    capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
  };
  return {
    defaultDisk: 'primary',
    diskNames: () => ['primary', 'secondary'],
    disk: () => driver,
  } as unknown as StorageManager;
}

describe('MediaConsoleService', () => {
  it('degrades every capability to an empty shape when nothing is configured', async () => {
    const service = new MediaConsoleService(null, null, null, null);
    expect(service.listDisks()).toEqual({ disks: [] });
    expect(await service.listUploads({})).toEqual({ uploads: [] });
    expect(await service.listCollections()).toEqual({ collections: [] });
    expect(await service.listLibrary({})).toEqual({ records: [] });
    expect(service.topology()).toEqual({
      hasStore: false,
      hasUploads: false,
      disks: 0,
      actions: false,
    });
  });

  it('lists disks with default flag + capabilities', () => {
    const service = new MediaConsoleService(fakeStorage(), null, null, true);
    const result = service.listDisks();
    expect(result.disks.map((d) => d.name)).toEqual(['primary', 'secondary']);
    expect(result.disks[0]?.default).toBe(true);
    expect(result.disks[1]?.default).toBe(false);
    expect(result.disks[0]?.capabilities.presign).toBe(true);
    expect(service.topology().actions).toBe(true);
  });

  it('maps live uploads with a computed percent', async () => {
    const session: UploadSession = {
      id: 'u1',
      disk: 'primary',
      key: 'a/b.bin',
      contentType: 'application/octet-stream',
      size: 200,
      offset: 50,
      parts: 2,
    };
    const uploads = { list: async () => [session] } as unknown as UploadSessionStore;
    const service = new MediaConsoleService(fakeStorage(), null, uploads, false);
    const result = await service.listUploads({});
    expect(result.uploads).toHaveLength(1);
    expect(result.uploads[0]?.percent).toBe(25);
    expect(result.uploads[0]?.multipart).toBe(false);
  });

  it('maps a library page and forwards the cursor', async () => {
    const page: MediaListResult = {
      records: [
        {
          id: 'm1',
          ownerType: 'Post',
          ownerId: '1',
          collection: 'gallery',
          name: 'file',
          fileName: 'file.png',
          mimeType: 'image/png',
          size: 10,
          disk: 'primary',
          path: 'p',
          order: 0,
          customProperties: {},
          conversions: {},
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      cursor: 'next',
    };
    const store = { list: async () => page } as unknown as MediaStore;
    const service = new MediaConsoleService(fakeStorage(), store, null, false);
    const result = await service.listLibrary({ collection: 'gallery' });
    expect(result.records[0]?.id).toBe('m1');
    expect(result.records[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.cursor).toBe('next');
    expect(service.topology().hasStore).toBe(true);
  });
});
