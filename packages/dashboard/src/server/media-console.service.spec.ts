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

  it('deletes a folder recursively: flat listing (empty delimiter), paginated, marker last', async () => {
    const listCalls: Array<{ prefix: string; delimiter?: string; cursor?: string }> = [];
    const deleted: string[] = [];
    const driver = {
      capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
      list: async (
        prefix: string,
        options?: { delimiter?: string; cursor?: string; limit?: number },
      ) => {
        listCalls.push({ prefix, delimiter: options?.delimiter, cursor: options?.cursor });
        if (options?.cursor === undefined) {
          return {
            folders: [],
            files: [{ key: 'reports/deep/a.txt', name: 'deep/a.txt' }],
            cursor: 'p2',
          };
        }
        return { folders: [], files: [{ key: 'reports/b.txt', name: 'b.txt' }] };
      },
      delete: async (key: string) => {
        deleted.push(key);
      },
    };
    const storage = {
      defaultDisk: 'primary',
      diskNames: () => ['primary'],
      disk: () => driver,
    } as unknown as StorageManager;
    const service = new MediaConsoleService(storage, null, null, true);

    await service.deleteFolder('primary', 'reports');

    // Every list call swept the folder prefix with an EMPTY delimiter (flat, so nested keys surface).
    expect(listCalls.every((call) => call.prefix === 'reports/' && call.delimiter === '')).toBe(
      true,
    );
    expect(listCalls.map((call) => call.cursor)).toEqual([undefined, 'p2']);
    // Nested files across both pages, then the folder marker itself, deleted last.
    expect(deleted).toEqual(['reports/deep/a.txt', 'reports/b.txt', 'reports/']);
  });

  it('moves a folder recursively, preserving relative paths and relocating the marker', async () => {
    const moves: Array<{ from: string; to: string }> = [];
    const puts: string[] = [];
    const deletes: string[] = [];
    const driver = {
      capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
      list: async (_prefix: string, options?: { cursor?: string }) => {
        if (options?.cursor === undefined) {
          return { folders: [], files: [{ key: 'bases/deep/a.txt', name: 'deep/a.txt' }] };
        }
        return { folders: [], files: [] };
      },
      move: async (from: string, to: string) => {
        moves.push({ from, to });
      },
      put: async (key: string) => {
        puts.push(key);
      },
      delete: async (key: string) => {
        deletes.push(key);
      },
    };
    const storage = {
      defaultDisk: 'primary',
      diskNames: () => ['primary'],
      disk: () => driver,
    } as unknown as StorageManager;
    const service = new MediaConsoleService(storage, null, null, true);

    await service.moveFolder('primary', 'bases', 'primary', 'templates/bases');

    // Each key relocates under the destination with its relative path intact.
    expect(moves).toEqual([{ from: 'bases/deep/a.txt', to: 'templates/bases/deep/a.txt' }]);
    // Destination marker written, source marker removed.
    expect(puts).toEqual(['templates/bases/']);
    expect(deletes).toEqual(['bases/']);
  });

  it('rejects moving a folder into itself or a descendant (same disk)', async () => {
    const driver = {
      capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
    };
    const storage = {
      defaultDisk: 'primary',
      diskNames: () => ['primary'],
      disk: () => driver,
    } as unknown as StorageManager;
    const service = new MediaConsoleService(storage, null, null, true);
    await expect(service.moveFolder('primary', 'bases', 'primary', 'bases/sub')).rejects.toThrow(
      /into itself/,
    );
  });

  it('moves an object across disks by streaming get→put→delete (no driver copy/move)', async () => {
    const primaryOps: string[] = [];
    const secondaryPuts: Array<{ key: string; contentType?: string }> = [];
    const primary = {
      capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
      stat: async () => ({ size: 12, contentType: 'image/png' }),
      get: async () => {
        primaryOps.push('get');
        return Buffer.from('hello world!');
      },
      delete: async (key: string) => {
        primaryOps.push(`delete:${key}`);
      },
      copy: async () => {
        throw new Error('driver.copy must not be used across disks');
      },
      move: async () => {
        throw new Error('driver.move must not be used across disks');
      },
    };
    const secondary = {
      capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
      put: async (key: string, _body: Buffer, options?: { contentType?: string }) => {
        secondaryPuts.push({
          key,
          ...(options?.contentType ? { contentType: options.contentType } : {}),
        });
      },
    };
    const storage = {
      defaultDisk: 'primary',
      diskNames: () => ['primary', 'secondary'],
      disk: (name: string) => (name === 'secondary' ? secondary : primary),
    } as unknown as StorageManager;
    const service = new MediaConsoleService(storage, null, null, true);

    await service.moveObject('primary', 'a/logo.png', 'secondary', 'b/logo.png');

    // Bytes stream through the pod, content type is preserved, and the source is removed for a move.
    expect(primaryOps).toEqual(['get', 'delete:a/logo.png']);
    expect(secondaryPuts).toEqual([{ key: 'b/logo.png', contentType: 'image/png' }]);
  });

  it('rejects a cross-disk transfer larger than the buffered ceiling', async () => {
    const primary = {
      capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
      stat: async () => ({ size: 200 * 1024 * 1024, contentType: 'application/octet-stream' }),
      get: async () => Buffer.alloc(0),
    };
    const secondary = {
      capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
      put: async () => undefined,
    };
    const storage = {
      defaultDisk: 'primary',
      diskNames: () => ['primary', 'secondary'],
      disk: (name: string) => (name === 'secondary' ? secondary : primary),
    } as unknown as StorageManager;
    const service = new MediaConsoleService(storage, null, null, true);

    await expect(
      service.copyObject('primary', 'huge.bin', 'secondary', 'huge.bin'),
    ).rejects.toThrow(/too large|limit/i);
  });
});
