import { InMemoryDriver } from '@dudousxd/nestjs-media-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Attachment, AttachmentManager } from './attachment';
import type { ImageProcessor } from './image-processor';
import { StorageManager } from './storage-manager';

let disk: InMemoryDriver;
let storage: StorageManager;
let ids: number;

const processor = (): ImageProcessor => ({
  convert: vi.fn(async (_input, preset) => ({
    data: Buffer.from(`${preset.name}-data`),
    format: 'webp',
    contentType: 'image/webp',
  })),
});

function manager(imageProcessor?: ImageProcessor) {
  ids = 0;
  return new AttachmentManager({
    storage,
    ...(imageProcessor ? { imageProcessor } : {}),
    idGenerator: () => `att-${++ids}`,
  });
}

beforeEach(() => {
  disk = new InMemoryDriver();
  storage = new StorageManager({ default: 'local', disks: { local: disk } });
});

describe('AttachmentManager', () => {
  it('createFromFile uploads bytes and returns a value object', async () => {
    const att = await manager().createFromFile({
      fileName: 'avatar.png',
      mimeType: 'image/png',
      contents: Buffer.from('bytes'),
    });
    expect(att.name).toBe('avatar.png');
    expect(att.disk).toBe('local');
    expect(att.path).toBe('attachments/att-1/avatar.png');
    expect(att.size).toBe(5);
    expect((await disk.get(att.path)).toString()).toBe('bytes');
  });

  it('generates variants when presets + a processor are given', async () => {
    const proc = processor();
    const att = await manager(proc).createFromFile(
      { fileName: 'a.png', mimeType: 'image/png', contents: Buffer.from('img') },
      { variants: [{ name: 'thumb', width: 100 }] },
    );
    expect(att.variants.thumb?.path).toBe('attachments/att-1/variants/thumb.webp');
    expect((await disk.get(att.variants.thumb?.path ?? '')).toString()).toBe('thumb-data');
    expect(proc.convert).toHaveBeenCalledTimes(1);
  });

  it('round-trips through toJSON / fromJSON', () => {
    const att = new Attachment({
      name: 'a.png',
      disk: 'local',
      path: 'p',
      size: 1,
      mimeType: 'image/png',
      variants: { thumb: { disk: 'local', path: 'v', size: 1, mimeType: 'image/webp' } },
      meta: { alt: 'x' },
    });
    const back = Attachment.fromJSON(JSON.parse(JSON.stringify(att.toJSON())));
    expect(back?.path).toBe('p');
    expect(back?.variants.thumb?.path).toBe('v');
    expect(Attachment.fromJSON(null)).toBeNull();
  });

  it('delete removes the file and its variants', async () => {
    const att = await manager(processor()).createFromFile(
      { fileName: 'a.png', mimeType: 'image/png', contents: Buffer.from('img') },
      { variants: [{ name: 'thumb', width: 100 }] },
    );
    await manager().delete(att);
    expect(await disk.exists(att.path)).toBe(false);
    expect(await disk.exists(att.variants.thumb?.path ?? '')).toBe(false);
  });

  it('throws for an unknown variant on url()', async () => {
    const publicDisk = new InMemoryDriver();
    vi.spyOn(publicDisk, 'url').mockResolvedValue('https://cdn/x');
    storage = new StorageManager({ default: 'local', disks: { local: publicDisk } });
    const att = await manager().createFromFile({
      fileName: 'a.png',
      mimeType: 'image/png',
      contents: Buffer.from('x'),
    });
    expect(await manager().url(att)).toBe('https://cdn/x');
    await expect(manager().url(att, 'nope')).rejects.toThrow(/variant/);
  });
});
