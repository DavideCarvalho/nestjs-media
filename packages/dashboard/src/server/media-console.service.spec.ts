import { Readable } from 'node:stream';
import type {
  MediaListResult,
  MediaStore,
  ReadRangeOptions,
  StorageManager,
  UploadSession,
  UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
import { describe, expect, it } from 'vitest';
import {
  MediaConsoleService,
  RangeNotSatisfiableException,
  type RequestedReadRange,
} from './media-console.service.js';

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

  it('drops phantom empty-name folders (leading-slash CommonPrefix) from a listing', async () => {
    const driver = {
      capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
      list: async () => ({
        // A stray leading-slash key makes S3 emit a "/" CommonPrefix (empty name) — the self-
        // referential trap that froze the tree. It must not reach the client.
        folders: ['/', 'bases/', 'templates/'],
        files: [{ key: 'a.txt', name: 'a.txt', sizeBytes: 1, lastModified: null }],
      }),
    };
    const storage = {
      defaultDisk: 'primary',
      diskNames: () => ['primary'],
      disk: () => driver,
    } as unknown as StorageManager;
    const service = new MediaConsoleService(storage, null, null, true);

    const result = await service.listObjects('primary', {});
    expect(result.folders.map((folder) => folder.prefix)).toEqual(['bases/', 'templates/']);
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
        listCalls.push({
          prefix,
          ...(options?.delimiter !== undefined ? { delimiter: options.delimiter } : {}),
          ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
        });
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

describe('MediaConsoleService.objectInsights', () => {
  const ctx = { disk: 'primary', key: 'rag/kb-1/handbook.pdf' };

  it('returns nothing when the host registered no providers', async () => {
    const none = new MediaConsoleService(fakeStorage(), null, null, null, null);
    expect(await none.objectInsights(ctx.disk, ctx.key)).toEqual({ insights: [] });

    const empty = new MediaConsoleService(fakeStorage(), null, null, null, []);
    expect(await empty.objectInsights(ctx.disk, ctx.key)).toEqual({ insights: [] });
  });

  it('collects what every provider says, dropping the ones with nothing to say', async () => {
    const service = new MediaConsoleService(fakeStorage(), null, null, null, [
      {
        id: 'rag',
        resolve: async ({ key }) => ({
          title: 'Knowledge base',
          facts: [{ label: 'Collection', value: key.split('/')[1] ?? '' }],
        }),
      },
      // The common case: a provider that cares about a different prefix.
      { id: 'work-orders', resolve: () => null },
    ]);

    expect(await service.objectInsights(ctx.disk, ctx.key)).toEqual({
      insights: [{ title: 'Knowledge base', facts: [{ label: 'Collection', value: 'kb-1' }] }],
    });
  });

  it('a provider that throws is skipped, and the others still render', async () => {
    // The property that matters: annotation must never be able to stop an admin opening a file.
    const service = new MediaConsoleService(fakeStorage(), null, null, null, [
      {
        id: 'broken',
        resolve: () => {
          throw new Error('database is down');
        },
      },
      { id: 'fine', resolve: () => ({ title: 'Still here' }) },
    ]);

    expect(await service.objectInsights(ctx.disk, ctx.key)).toEqual({
      insights: [{ title: 'Still here' }],
    });
  });

  it('404s an unknown disk rather than handing providers a key from nowhere', async () => {
    const service = new MediaConsoleService(fakeStorage(), null, null, null, [
      { id: 'x', resolve: () => ({ title: 'never reached' }) },
    ]);
    await expect(service.objectInsights('no-such-disk', ctx.key)).rejects.toThrow(/Unknown disk/);
  });

  it('drops a link the console must not render, and keeps the ones it may', async () => {
    const service = new MediaConsoleService(fakeStorage(), null, null, null, [
      {
        id: 'links',
        resolve: () => ({
          title: 'Links',
          links: [
            { label: 'host page', href: '/ctrl/rag/kb-1' },
            { label: 'external', href: 'https://example.test/doc' },
            // A provider that interpolated user text into a URL — this is what the filter is for.
            { label: 'xss', href: 'javascript:alert(1)' },
            // Protocol-relative: an absolute URL wearing a relative one's clothes.
            { label: 'offsite', href: '//evil.test/steal' },
          ],
        }),
      },
    ]);

    const { insights } = await service.objectInsights(ctx.disk, ctx.key);
    expect(insights[0]?.links?.map((link) => link.label)).toEqual(['host page', 'external']);
  });
});

describe('MediaConsoleService.objectStream ranges', () => {
  const CONTENT = 'abcdefghij';

  /** A disk holding one 10-byte object, recording the range each `stream()` was asked for. */
  function rangedStorage(options?: { ranged?: boolean; size?: number }) {
    const asked: Array<ReadRangeOptions | undefined> = [];
    const size = options?.size ?? CONTENT.length;
    const driver = {
      capabilities: {
        presign: true,
        multipart: true,
        publicUrls: false,
        list: true,
        ranged: options?.ranged ?? true,
      },
      stat: async () => ({ size, contentType: 'text/plain' }),
      stream: async (_key: string, range?: ReadRangeOptions) => {
        asked.push(range);
        const slice = range
          ? CONTENT.slice(range.start, range.end === undefined ? undefined : range.end + 1)
          : CONTENT;
        return Readable.from(Buffer.from(slice));
      },
    };
    const storage = {
      defaultDisk: 'primary',
      diskNames: () => ['primary'],
      disk: () => driver,
    } as unknown as StorageManager;
    return { storage, asked };
  }

  const drain = async (stream: Readable): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString();
  };

  it('leaves a range-less read exactly as it was: whole body, no resolved range', async () => {
    const { storage, asked } = rangedStorage();
    const service = new MediaConsoleService(storage, null, null, false);
    const result = await service.objectStream('primary', 'a.txt');
    expect(result.size).toBe(10);
    expect(result.contentType).toBe('text/plain');
    expect(result.range).toBeUndefined();
    expect(asked).toEqual([undefined]);
    expect(await drain(result.stream)).toBe(CONTENT);
  });

  it('passes a satisfiable range through and reports it absolutely, with the OBJECT size', async () => {
    const { storage, asked } = rangedStorage();
    const service = new MediaConsoleService(storage, null, null, false);
    const result = await service.objectStream('primary', 'a.txt', { start: 2, end: 4 });
    expect(asked).toEqual([{ start: 2, end: 4 }]);
    expect(result.range).toEqual({ start: 2, end: 4 });
    // `size` is the whole object, not the slice — it is the denominator of `Content-Range`.
    expect(result.size).toBe(10);
    expect(await drain(result.stream)).toBe('cde');
  });

  it('clamps an end past EOF instead of failing — the tail of a file is an ordinary read', async () => {
    const { storage, asked } = rangedStorage();
    const service = new MediaConsoleService(storage, null, null, false);
    const result = await service.objectStream('primary', 'a.txt', { start: 6, end: 99999 });
    expect(asked).toEqual([{ start: 6, end: 9 }]);
    expect(result.range).toEqual({ start: 6, end: 9 });
    expect(await drain(result.stream)).toBe('ghij');
  });

  it('resolves an omitted end to the last byte', async () => {
    const { storage } = rangedStorage();
    const service = new MediaConsoleService(storage, null, null, false);
    const result = await service.objectStream('primary', 'a.txt', { start: 8 });
    expect(result.range).toEqual({ start: 8, end: 9 });
  });

  it('resolves the suffix form (`bytes=-N`) against the size, and clamps an oversized suffix', async () => {
    const { storage } = rangedStorage();
    const service = new MediaConsoleService(storage, null, null, false);
    expect((await service.objectStream('primary', 'a.txt', { suffixLength: 3 })).range).toEqual({
      start: 7,
      end: 9,
    });
    // A suffix longer than the object is the whole object, not a negative start.
    expect((await service.objectStream('primary', 'a.txt', { suffixLength: 500 })).range).toEqual({
      start: 0,
      end: 9,
    });
  });

  it('416s an unsatisfiable range, carrying the size the client needs to re-ask', async () => {
    const { storage, asked } = rangedStorage();
    const service = new MediaConsoleService(storage, null, null, false);
    const cases: RequestedReadRange[] = [
      { start: 10 }, // exactly at EOF — there is no byte 10 in a 10-byte object
      { start: 40, end: 60 }, // wholly past EOF
      { start: 5, end: 2 }, // inverted
      { suffixLength: 0 }, // `bytes=-0` asks for nothing
    ];
    for (const range of cases) {
      const failure = await service
        .objectStream('primary', 'a.txt', range)
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(RangeNotSatisfiableException);
      expect((failure as RangeNotSatisfiableException).size).toBe(10);
      expect((failure as RangeNotSatisfiableException).getStatus()).toBe(416);
    }
    // Nothing reached the driver — an unsatisfiable range never opens a body.
    expect(asked).toEqual([]);
  });

  it('416s every range against a zero-byte object', async () => {
    const { storage } = rangedStorage({ size: 0 });
    const service = new MediaConsoleService(storage, null, null, false);
    await expect(service.objectStream('primary', 'empty', { start: 0 })).rejects.toBeInstanceOf(
      RangeNotSatisfiableException,
    );
  });

  it('refuses a range on a driver that cannot serve one, rather than returning the whole object', async () => {
    const { storage, asked } = rangedStorage({ ranged: false });
    const service = new MediaConsoleService(storage, null, null, false);
    // The silent alternative — 400 MB where 64 KB was asked for — is the whole reason `ranged` is a
    // required capability, so this must be an error and not a full body.
    await expect(service.objectStream('primary', 'a.txt', { start: 0, end: 9 })).rejects.toThrow(
      /cannot serve byte ranges/,
    );
    expect(asked).toEqual([]);
    // The un-ranged read still works on such a disk.
    expect((await service.objectStream('primary', 'a.txt')).range).toBeUndefined();
  });
});
