import { InMemoryDriver, InMemoryMediaStore } from '@dudousxd/nestjs-media-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversionNotDefinedError, ImageProcessorMissingError } from './errors';
import type { ImageProcessor } from './image-processor';
import { MediaLibrary } from './media-library';
import { StorageManager } from './storage-manager';

let disk: InMemoryDriver;
let storage: StorageManager;
let store: InMemoryMediaStore;

// Fake processor: prefixes the bytes so we can assert it ran, and reports webp.
const fakeProcessor = (): ImageProcessor => ({
  convert: vi.fn(async (input: Buffer, preset) => ({
    data: Buffer.concat([Buffer.from(`${preset.name}:`), input]),
    format: 'webp',
    contentType: 'image/webp',
  })),
});

beforeEach(() => {
  disk = new InMemoryDriver();
  storage = new StorageManager({ default: 'local', disks: { local: disk } });
  store = new InMemoryMediaStore();
});

const attachInput = {
  ownerType: 'Post',
  ownerId: '1',
  collection: 'gallery',
  fileName: 'photo.png',
  mimeType: 'image/png',
  contents: Buffer.from('IMG'),
};

describe('MediaLibrary conversions', () => {
  it('attaches with no conversions until requested', async () => {
    const lib = new MediaLibrary({
      storage,
      store,
      imageProcessor: fakeProcessor(),
      collections: [{ name: 'gallery', conversions: [{ name: 'thumb', width: 100 }] }],
      idGenerator: () => 'id-1',
      clock: () => new Date(0),
    });
    const media = await lib.attach(attachInput);
    expect(media.conversions).toEqual({});
  });

  it('lazily produces + caches the variant and serves it', async () => {
    const processor = fakeProcessor();
    const publicDisk = new InMemoryDriver();
    // Give the disk a public url by spying:
    vi.spyOn(publicDisk, 'url').mockImplementation(async (p: string) => `https://cdn/${p}`);
    storage = new StorageManager({ default: 'local', disks: { local: publicDisk } });

    const lib = new MediaLibrary({
      storage,
      store,
      imageProcessor: processor,
      collections: [{ name: 'gallery', conversions: [{ name: 'thumb', width: 100 }] }],
      idGenerator: () => 'id-1',
      clock: () => new Date(0),
    });
    await lib.attach(attachInput);

    const url = await lib.url('id-1', 'thumb');
    expect(url).toBe('https://cdn/Post/1/gallery/id-1/conversions/thumb.webp');
    expect(processor.convert).toHaveBeenCalledTimes(1);
    // Cached bytes contain the processor marker:
    const stored = await publicDisk.get('Post/1/gallery/id-1/conversions/thumb.webp');
    expect(stored.toString()).toBe('thumb:IMG');

    // Second access reuses the cache (no second convert call).
    await lib.url('id-1', 'thumb');
    expect(processor.convert).toHaveBeenCalledTimes(1);
  });

  it('generates eager conversions during attach', async () => {
    const processor = fakeProcessor();
    const lib = new MediaLibrary({
      storage,
      store,
      imageProcessor: processor,
      collections: [{ name: 'gallery', conversions: [{ name: 'og', width: 1200, eager: true }] }],
      idGenerator: () => 'id-1',
      clock: () => new Date(0),
    });
    const media = await lib.attach(attachInput);
    expect(media.conversions.og?.path).toBe('Post/1/gallery/id-1/conversions/og.webp');
    expect(processor.convert).toHaveBeenCalledTimes(1);
  });

  it('throws when the conversion is not defined for the collection', async () => {
    const lib = new MediaLibrary({
      storage,
      store,
      imageProcessor: fakeProcessor(),
      collections: [{ name: 'gallery' }],
      idGenerator: () => 'id-1',
      clock: () => new Date(0),
    });
    await lib.attach(attachInput);
    await expect(lib.ensureConversion('id-1', 'thumb')).rejects.toBeInstanceOf(
      ConversionNotDefinedError,
    );
  });

  it('throws when conversions are configured but no processor is provided', async () => {
    const lib = new MediaLibrary({
      storage,
      store,
      collections: [{ name: 'gallery', conversions: [{ name: 'thumb', width: 100 }] }],
      idGenerator: () => 'id-1',
      clock: () => new Date(0),
    });
    await lib.attach(attachInput);
    await expect(lib.ensureConversion('id-1', 'thumb')).rejects.toBeInstanceOf(
      ImageProcessorMissingError,
    );
  });
});
