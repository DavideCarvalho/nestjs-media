import { InMemoryMediaStore, storageOf } from '@dudousxd/nestjs-media-testing';
import { InMemoryDisk, type Storage } from '@nestjs/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { MimeNotAllowedError } from './errors';
import { MediaLibrary } from './media-library';

let disk: InMemoryDisk;
let storage: Storage;
let store: InMemoryMediaStore;
let ids: number;

function makeLibrary(collections?: ConstructorParameters<typeof MediaLibrary>[0]['collections']) {
  ids = 0;
  return new MediaLibrary({
    storage,
    store,
    ...(collections ? { collections } : {}),
    idGenerator: () => `id-${++ids}`,
    clock: () => new Date(0),
  });
}

beforeEach(() => {
  disk = new InMemoryDisk();
  storage = storageOf({ local: disk }, 'local');
  store = new InMemoryMediaStore();
});

describe('MediaLibrary', () => {
  it('attaches a file: writes bytes to disk and persists a record', async () => {
    const lib = makeLibrary();
    const media = await lib.attach({
      ownerType: 'Post',
      ownerId: '7',
      collection: 'gallery',
      fileName: 'photo.png',
      mimeType: 'image/png',
      contents: Buffer.from('bytes'),
    });

    expect(media.id).toBe('id-1');
    expect(media.name).toBe('photo');
    expect(media.disk).toBe('local');
    expect(media.path).toBe('Post/7/gallery/id-1/photo.png');
    expect(media.size).toBe(5);
    expect(media.order).toBe(0);
    expect(await disk.getText(media.path)).toBe('bytes');
    expect((await store.find('id-1'))?.id).toBe('id-1');
  });

  it('appends multiple files with increasing order', async () => {
    const lib = makeLibrary();
    const base = { ownerType: 'Post', ownerId: '1', collection: 'gallery', mimeType: 'image/png' };
    const a = await lib.attach({ ...base, fileName: 'a.png', contents: Buffer.from('a') });
    const b = await lib.attach({ ...base, fileName: 'b.png', contents: Buffer.from('b') });
    expect([a.order, b.order]).toEqual([0, 1]);
    expect((await lib.list('Post', '1', 'gallery')).map((r) => r.id)).toEqual(['id-1', 'id-2']);
  });

  it('single-file collection replaces the previous file (record + bytes)', async () => {
    const lib = makeLibrary([{ name: 'avatar', single: true }]);
    const base = { ownerType: 'User', ownerId: '1', collection: 'avatar', mimeType: 'image/png' };
    const first = await lib.attach({ ...base, fileName: 'old.png', contents: Buffer.from('old') });
    const second = await lib.attach({ ...base, fileName: 'new.png', contents: Buffer.from('new') });

    const list = await lib.list('User', '1', 'avatar');
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(second.id);
    expect(await disk.exists(first.path)).toBe(false);
  });

  it('rejects a disallowed MIME type for the collection', async () => {
    const lib = makeLibrary([{ name: 'docs', acceptsMimeTypes: ['application/pdf'] }]);
    await expect(
      lib.attach({
        ownerType: 'Post',
        ownerId: '1',
        collection: 'docs',
        fileName: 'x.png',
        mimeType: 'image/png',
        contents: Buffer.from('x'),
      }),
    ).rejects.toBeInstanceOf(MimeNotAllowedError);
  });

  it('honors the collection disk override', async () => {
    const s3 = new InMemoryDisk();
    storage = storageOf({ local: disk, s3 }, 'local');
    const lib = makeLibrary([{ name: 'gallery', disk: 's3' }]);
    const media = await lib.attach({
      ownerType: 'Post',
      ownerId: '1',
      collection: 'gallery',
      fileName: 'a.png',
      mimeType: 'image/png',
      contents: Buffer.from('z'),
    });
    expect(media.disk).toBe('s3');
    expect(await s3.exists(media.path)).toBe(true);
  });

  it('delete removes the record and the stored bytes', async () => {
    const lib = makeLibrary();
    const media = await lib.attach({
      ownerType: 'Post',
      ownerId: '1',
      collection: 'gallery',
      fileName: 'a.png',
      mimeType: 'image/png',
      contents: Buffer.from('z'),
    });
    await lib.delete(media.id);
    expect(await store.find(media.id)).toBeNull();
    expect(await disk.exists(media.path)).toBe(false);
  });

  it('for() binds an owner so attach/list omit ownerType/ownerId', async () => {
    const lib = makeLibrary();
    const post = lib.for('Post', 42); // numeric id is coerced to a string
    const media = await post.attach({
      collection: 'gallery',
      fileName: 'a.png',
      mimeType: 'image/png',
      contents: Buffer.from('z'),
    });

    expect(media.ownerType).toBe('Post');
    expect(media.ownerId).toBe('42');
    expect((await post.list('gallery')).map((r) => r.id)).toEqual([media.id]);
    expect((await post.list()).map((r) => r.id)).toEqual([media.id]);
  });
});

describe('MediaLibrary on @nestjs/storage', () => {
  const input = {
    ownerType: 'Post',
    ownerId: '7',
    collection: 'gallery',
    mimeType: 'image/png',
    contents: Buffer.from('bytes'),
  };

  it('makes a hostile file name one safe key segment, keeping the record’s fileName', async () => {
    const media = await makeLibrary().attach({ ...input, fileName: '../../etc/passwd' });
    expect(media.path).toBe('Post/7/gallery/id-1/.._.._etc_passwd');
    expect(media.fileName).toBe('../../etc/passwd');
    expect(await disk.getText(media.path)).toBe('bytes');
  });

  it('url() is the public URL when the disk has one', async () => {
    disk = new InMemoryDisk({ publicUrl: 'https://cdn.example.com/media' });
    storage = storageOf({ local: disk });
    const lib = makeLibrary();
    const media = await lib.attach({ ...input, fileName: 'a b.png' });
    expect(await lib.url(media.id)).toBe(
      'https://cdn.example.com/media/Post/7/gallery/id-1/a%20b.png',
    );
  });

  it('url() falls back to a signed URL on a private disk', async () => {
    disk = new InMemoryDisk({
      signedUrls: { baseUrl: 'https://api.example.com/files', keys: ['k'.repeat(32)] },
    });
    storage = storageOf({ local: disk });
    const lib = makeLibrary();
    const media = await lib.attach({ ...input, fileName: 'a.png' });
    const url = await lib.url(media.id);
    expect(url.startsWith('https://api.example.com/files?')).toBe(true);
    expect(disk.verifySignedUrl(url).key).toBe(media.path);
  });

  it('url() on a disk with neither public nor signed URLs throws the disk’s error', async () => {
    const lib = makeLibrary();
    const media = await lib.attach({ ...input, fileName: 'a.png' });
    await expect(lib.url(media.id)).rejects.toThrow(/signedUrls/);
  });

  it('locate() names the stored file', async () => {
    const lib = makeLibrary();
    const media = await lib.attach({ ...input, fileName: 'a.png' });
    expect(await lib.locate(media.id)).toMatchObject({
      disk: 'local',
      path: media.path,
      fileName: 'a.png',
    });
  });
});
