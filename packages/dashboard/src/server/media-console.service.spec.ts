import { Readable } from 'node:stream';
import type {
  MediaListResult,
  MediaStore,
  MultipartUploadDriver,
  UploadSession,
  UploadSessionStore,
} from '@dudousxd/nestjs-media-core';
import { storageOf } from '@dudousxd/nestjs-media-testing';
import { HttpException } from '@nestjs/common';
import { InMemoryDisk, S3Disk, type Storage } from '@nestjs/storage';
import { describe, expect, it } from 'vitest';
import { MediaConsoleService } from './media-console.service.js';

function fakeStorage(): Storage {
  return storageOf({ primary: new InMemoryDisk(), secondary: new InMemoryDisk() }, 'primary');
}

async function seeded(keys: string[], disk = new InMemoryDisk()): Promise<InMemoryDisk> {
  for (const key of keys) await disk.put(key, `body of ${key}`);
  return disk;
}

describe('MediaConsoleService', () => {
  it('degrades every capability to an empty shape when nothing is configured', async () => {
    const service = new MediaConsoleService(null, null, null, null);
    expect(await service.listDisks()).toEqual({ disks: [] });
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

  it('lists disks with default flag + capabilities computed from the disk and its side-car', async () => {
    const storage = storageOf(
      {
        primary: new S3Disk({
          bucket: 'media-bucket',
          region: 'us-east-1',
          credentials: { accessKeyId: 'a', secretAccessKey: 's' },
        }),
        secondary: new InMemoryDisk({ publicUrl: 'https://cdn.example' }),
      },
      'primary',
    );
    const service = new MediaConsoleService(storage, null, null, true, null, null, {
      primary: {} as MultipartUploadDriver,
    });
    const result = await service.listDisks();
    expect(result.disks.map((d) => d.name)).toEqual(['primary', 'secondary']);
    expect(result.disks[0]?.default).toBe(true);
    expect(result.disks[1]?.default).toBe(false);
    expect(result.disks[0]?.capabilities).toEqual({
      presign: true,
      multipart: true,
      publicUrls: false,
      list: true,
      ranged: true,
    });
    expect(result.disks[1]?.capabilities).toMatchObject({
      presign: false,
      multipart: false,
      publicUrls: true,
    });
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

describe('MediaConsoleService — listing', () => {
  it('folds a flat listing into one folder level, hiding .keep files', async () => {
    const disk = await seeded([
      'docs/a.txt',
      'docs/sub/b.txt',
      'docs/sub/deep/c.txt',
      'docs/empty/.keep',
      'top.txt',
    ]);
    const service = new MediaConsoleService(storageOf({ primary: disk }), null, null, true);

    const root = await service.listObjects('primary', {});
    expect(root.folders).toEqual([{ name: 'docs', prefix: 'docs/' }]);
    expect(root.files.map((f) => f.name)).toEqual(['top.txt']);

    const docs = await service.listObjects('primary', { prefix: 'docs' });
    expect(docs.folders.map((f) => f.prefix)).toEqual(['docs/empty/', 'docs/sub/']);
    expect(docs.files).toEqual([
      expect.objectContaining({ key: 'docs/a.txt', name: 'a.txt', sizeBytes: 18 }),
    ]);

    const empty = await service.listObjects('primary', { prefix: 'docs/empty/' });
    expect(empty).toEqual({ folders: [], files: [] });
  });

  it('pages a folded listing with a cursor, never repeating a folder', async () => {
    const disk = await seeded(['a/1', 'a/2', 'b.txt', 'c/1', 'd.txt']);
    const service = new MediaConsoleService(storageOf({ primary: disk }), null, null, true);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.listObjects('primary', {
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.folders.map((f) => f.prefix), ...page.files.map((f) => f.key));
      cursor = page.cursor;
    } while (cursor);
    expect(seen).toEqual(['a/', 'b.txt', 'c/', 'd.txt']);
  });

  it('uses the side-car delimiter listing when it has one, dropping phantom folders', async () => {
    const sidecar = {
      listFolders: async () => ({
        folders: ['bases/', 'templates/', '/'],
        files: [{ key: 'a.txt', size: 1, lastModified: new Date(0) }],
      }),
    } as unknown as MultipartUploadDriver;
    const service = new MediaConsoleService(
      storageOf({ primary: new InMemoryDisk() }),
      null,
      null,
      true,
      null,
      null,
      { primary: sidecar },
    );
    const result = await service.listObjects('primary', {});
    expect(result.folders.map((f) => f.name)).toEqual(['bases', 'templates']);
    expect(result.files.map((f) => f.key)).toEqual(['a.txt']);
  });

  it('answers 400 for a prefix no disk accepts, 404 for an unknown disk', async () => {
    const service = new MediaConsoleService(fakeStorage(), null, null, true);
    await expect(service.listObjects('primary', { prefix: 'a/../b' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.listObjects('nope', {})).rejects.toMatchObject({ status: 404 });
  });
});

describe('MediaConsoleService — actions', () => {
  it('creates a folder as a hidden .keep file (no invalid `prefix/` marker)', async () => {
    const disk = new InMemoryDisk();
    const service = new MediaConsoleService(storageOf({ primary: disk }), null, null, true);
    await service.createFolder('primary', '/reports/2026/');
    expect(disk.keys()).toEqual(['reports/2026/.keep']);
    expect((await service.listObjects('primary', { prefix: 'reports/' })).folders).toEqual([
      { name: '2026', prefix: 'reports/2026/' },
    ]);
    await expect(service.createFolder('primary', '  ')).rejects.toMatchObject({ status: 400 });
    await expect(service.createFolder('primary', 'a//b')).rejects.toMatchObject({ status: 400 });
  });

  it('deletes a folder recursively, nested keys and .keep included, nothing else', async () => {
    const disk = await seeded(['f/a', 'f/sub/b', 'f/.keep', 'fx/keep-me', 'other']);
    const service = new MediaConsoleService(storageOf({ primary: disk }), null, null, true);
    await service.deleteFolder('primary', 'f');
    expect(disk.keys()).toEqual(['fx/keep-me', 'other']);
  });

  it('moves a folder recursively, preserving relative paths', async () => {
    const disk = await seeded(['src/a.txt', 'src/sub/b.txt', 'src/.keep']);
    const service = new MediaConsoleService(storageOf({ primary: disk }), null, null, true);
    await service.moveFolder('primary', 'src', 'primary', 'dst/');
    expect(disk.keys()).toEqual(['dst/.keep', 'dst/a.txt', 'dst/sub/b.txt']);
  });

  it('rejects moving a folder into itself or a descendant (same disk)', async () => {
    const service = new MediaConsoleService(fakeStorage(), null, null, true);
    await expect(service.moveFolder('primary', 'a', 'primary', 'a/b')).rejects.toThrow(
      /into itself/,
    );
    await expect(service.copyFolder('primary', 'a', 'primary', 'a')).rejects.toThrow(/into itself/);
  });

  it('copies a folder across disks, streaming each file with its content type', async () => {
    const from = new InMemoryDisk();
    await from.put('p/x.json', '{"a":1}', { contentType: 'application/json' });
    await from.put('p/y/z.bin', Buffer.alloc(3, 7));
    const to = new InMemoryDisk();
    const service = new MediaConsoleService(storageOf({ from, to }), null, null, true);
    await service.copyFolder('from', 'p', 'to', 'q');
    expect(to.keys()).toEqual(['q/x.json', 'q/y/z.bin']);
    expect((await to.stat('q/x.json')).contentType).toBe('application/json');
    expect(from.keys()).toEqual(['p/x.json', 'p/y/z.bin']);
  });

  it('moves an object across disks by streaming get→put, then deletes the source; no size cap', async () => {
    const from = new InMemoryDisk();
    const big = Buffer.alloc(150 * 1024 * 1024, 1);
    await from.put('big.bin', big);
    const to = new InMemoryDisk();
    const service = new MediaConsoleService(storageOf({ from, to }), null, null, true);
    await service.moveObject('from', 'big.bin', 'to', 'moved/big.bin');
    expect(await from.exists('big.bin')).toBe(false);
    expect((await to.stat('moved/big.bin')).size).toBe(big.length);
  });

  it('streams an upload onto the disk, and refuses a body shorter than its Content-Length', async () => {
    const disk = new InMemoryDisk();
    const service = new MediaConsoleService(storageOf({ primary: disk }), null, null, true);
    await service.putObject(
      'primary',
      'u/a.txt',
      Readable.from([Buffer.from('hi')]),
      'text/plain',
      2,
    );
    expect(await disk.getText('u/a.txt')).toBe('hi');
    await expect(
      service.putObject('primary', 'u/b.txt', Readable.from([Buffer.from('h')]), 'text/plain', 2),
    ).rejects.toBeInstanceOf(HttpException);
    expect(await disk.exists('u/b.txt')).toBe(false);
  });

  it('a missing object is a 404', async () => {
    const service = new MediaConsoleService(fakeStorage(), null, null, true);
    await expect(service.objectDetail('primary', 'missing')).rejects.toMatchObject({ status: 404 });
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

describe('MediaConsoleService — objectUrls', () => {
  const s3 = () =>
    new S3Disk({
      bucket: 'media-bucket',
      region: 'us-east-1',
      credentials: { accessKeyId: 'a', secretAccessKey: 's' },
    });

  it('signs by default, and when the host asks for auto', async () => {
    for (const config of [null, { strategy: 'auto' as const, apiBasePath: '/api/media' }]) {
      const disk = s3();
      // `objectDetail` stats the object; stand in for S3 there, sign for real.
      disk.stat = async (key) => ({
        key,
        size: 1,
        contentType: 'text/csv',
        lastModified: new Date(0),
        metadata: {},
      });
      const service = new MediaConsoleService(
        storageOf({ primary: disk }),
        null,
        null,
        false,
        null,
        config,
      );
      const detail = await service.objectDetail('primary', 'reports/q1.csv');
      const url = new URL(detail.url);
      expect(url.pathname).toBe('/reports/q1.csv');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    }
  });

  it('uses the public URL when the disk has one', async () => {
    const disk = await seeded(
      ['reports/q1.csv'],
      new InMemoryDisk({ publicUrl: 'https://cdn.example' }),
    );
    const service = new MediaConsoleService(storageOf({ primary: disk }), null, null, false);
    expect((await service.objectDetail('primary', 'reports/q1.csv')).url).toBe(
      'https://cdn.example/reports/q1.csv',
    );
  });

  it('falls back to this server under auto when the disk can neither sign nor publish', async () => {
    const disk = await seeded(['reports/q1.csv']);
    const service = new MediaConsoleService(storageOf({ primary: disk }), null, null, false, null, {
      strategy: 'auto',
      apiBasePath: '/api/media/console',
    });
    expect((await service.objectDetail('primary', 'reports/q1.csv')).url).toBe(
      '/api/media/console/disks/primary/object/raw?key=reports%2Fq1.csv',
    );
  });

  it('routes through this server under proxy, never touching the store', async () => {
    const disk = await seeded(
      ['reports/q1 final.csv'],
      new InMemoryDisk({ publicUrl: 'https://store.example' }),
    );
    const service = new MediaConsoleService(storageOf({ primary: disk }), null, null, false, null, {
      strategy: 'proxy',
      apiBasePath: '/api/media/console',
    });
    const detail = await service.objectDetail('primary', 'reports/q1 final.csv');
    expect(detail.url).toBe(
      '/api/media/console/disks/primary/object/raw?key=reports%2Fq1%20final.csv',
    );
    expect(detail.url).not.toContain('store.example');
  });
});
