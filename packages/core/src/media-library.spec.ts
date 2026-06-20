import { InMemoryDriver, InMemoryMediaStore } from '@dudousxd/nestjs-media-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { MimeNotAllowedError } from './errors';
import { MediaLibrary } from './media-library';
import { StorageManager } from './storage-manager';

let disk: InMemoryDriver;
let storage: StorageManager;
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
  disk = new InMemoryDriver();
  storage = new StorageManager({ default: 'local', disks: { local: disk } });
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
    expect((await disk.get(media.path)).toString()).toBe('bytes');
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
    const s3 = new InMemoryDriver();
    storage = new StorageManager({ default: 'local', disks: { local: disk, s3 } });
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
});
