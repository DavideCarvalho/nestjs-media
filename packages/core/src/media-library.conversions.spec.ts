import { Readable } from 'node:stream';
import { InMemoryMediaStore, storageOf } from '@dudousxd/nestjs-media-testing';
import { InMemoryDisk, type Storage } from '@nestjs/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversionNotDefinedError, ImageProcessorMissingError } from './errors';
import type { ImageProcessor } from './image-processor';
import { MediaLibrary } from './media-library';

let disk: InMemoryDisk;
let storage: Storage;
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
  disk = new InMemoryDisk();
  storage = storageOf({ local: disk }, 'local');
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
    const publicDisk = new InMemoryDisk({ publicUrl: 'https://cdn' });
    storage = storageOf({ local: publicDisk }, 'local');

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
    const stored = await publicDisk.getText('Post/1/gallery/id-1/conversions/thumb.webp');
    expect(stored).toBe('thumb:IMG');

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

  it('generates every eager conversion from one read of the original and saves the record once', async () => {
    const processor = fakeProcessor();
    const lib = new MediaLibrary({
      storage,
      store,
      imageProcessor: processor,
      collections: [
        {
          name: 'gallery',
          conversions: [
            { name: 'thumb', width: 100, eager: true },
            { name: 'og', width: 1200, eager: true },
            { name: 'hero', width: 2000, eager: true },
          ],
        },
      ],
      idGenerator: () => 'id-1',
      clock: () => new Date(0),
    });
    const find = vi.spyOn(store, 'find');
    const save = vi.spyOn(store, 'save');

    const media = await lib.attach(attachInput);

    expect(Object.keys(media.conversions)).toEqual(['thumb', 'og', 'hero']);
    expect(await disk.getText('Post/1/gallery/id-1/conversions/hero.webp')).toBe('hero:IMG');
    expect(processor.convert).toHaveBeenCalledTimes(3);
    expect(find).not.toHaveBeenCalled();
    // One save for the new record, one for its conversions.
    expect(save).toHaveBeenCalledTimes(2);
    expect((await store.find('id-1'))?.conversions).toEqual(media.conversions);
  });

  it('reads the original from disk exactly once for eager conversions of a streamed upload', async () => {
    const lib = new MediaLibrary({
      storage,
      store,
      imageProcessor: fakeProcessor(),
      collections: [
        {
          name: 'gallery',
          conversions: [
            { name: 'thumb', width: 100, eager: true },
            { name: 'og', width: 1200, eager: true },
          ],
        },
      ],
      idGenerator: () => 'id-1',
      clock: () => new Date(0),
    });
    const get = vi.spyOn(disk, 'getBuffer');

    // The only read is the conversions' source (the size comes back from put()).
    await lib.attach({ ...attachInput, size: 3, contents: Readable.from([Buffer.from('IMG')]) });

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('Post/1/gallery/id-1/photo.png');
  });

  it('uses an in-memory upload directly for eager conversions without reading it back', async () => {
    const lib = new MediaLibrary({
      storage,
      store,
      imageProcessor: fakeProcessor(),
      collections: [{ name: 'gallery', conversions: [{ name: 'og', width: 1200, eager: true }] }],
      idGenerator: () => 'id-1',
      clock: () => new Date(0),
    });
    const get = vi.spyOn(disk, 'getBuffer');

    await lib.attach({ ...attachInput, size: 3 });

    expect(get).not.toHaveBeenCalled();
  });

  it('keeps the eager conversions that succeeded when a later one fails', async () => {
    const processor: ImageProcessor = {
      convert: vi.fn(async (input: Buffer, preset) => {
        if (preset.name === 'og') throw new Error('boom');
        return { data: input, format: 'webp', contentType: 'image/webp' };
      }),
    };
    const lib = new MediaLibrary({
      storage,
      store,
      imageProcessor: processor,
      collections: [
        {
          name: 'gallery',
          conversions: [
            { name: 'thumb', width: 100, eager: true },
            { name: 'og', width: 1200, eager: true },
          ],
        },
      ],
      idGenerator: () => 'id-1',
      clock: () => new Date(0),
    });

    await expect(lib.attach(attachInput)).rejects.toThrow('boom');
    expect(Object.keys((await store.find('id-1'))?.conversions ?? {})).toEqual(['thumb']);
  });

  it('generates a lazy conversion once when it is requested concurrently', async () => {
    const processor = fakeProcessor();
    const lib = new MediaLibrary({
      storage,
      store,
      imageProcessor: processor,
      collections: [{ name: 'gallery', conversions: [{ name: 'thumb', width: 100 }] }],
      idGenerator: () => 'id-1',
      clock: () => new Date(0),
    });
    await lib.attach(attachInput);

    const records = await Promise.all(
      Array.from({ length: 5 }, () => lib.ensureConversion('id-1', 'thumb')),
    );

    expect(processor.convert).toHaveBeenCalledTimes(1);
    for (const record of records) {
      expect(record.conversions.thumb?.path).toBe('Post/1/gallery/id-1/conversions/thumb.webp');
    }
    // Settled requests are not cached: a failure or a regenerated original is retried.
    const [generated] = records;
    if (generated) await store.save({ ...generated, conversions: {} });
    await lib.ensureConversion('id-1', 'thumb');
    expect(processor.convert).toHaveBeenCalledTimes(2);
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
