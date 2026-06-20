import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { SharpImageProcessor } from './sharp-image-processor';

let source: Buffer;

beforeAll(async () => {
  // A 200x100 red PNG to convert.
  source = await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
});

describe('SharpImageProcessor', () => {
  it('resizes to the preset dimensions and converts to webp by default', async () => {
    const result = await new SharpImageProcessor().convert(source, { name: 'thumb', width: 50 });
    expect(result.format).toBe('webp');
    expect(result.contentType).toBe('image/webp');
    const meta = await sharp(result.data).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(50);
  });

  it('honors an explicit output format', async () => {
    const result = await new SharpImageProcessor().convert(source, {
      name: 'jpg',
      width: 80,
      format: 'jpeg',
      quality: 70,
    });
    expect(result.format).toBe('jpeg');
    expect(result.contentType).toBe('image/jpeg');
    expect((await sharp(result.data).metadata()).format).toBe('jpeg');
  });

  it('respects fit when both dimensions are set', async () => {
    const result = await new SharpImageProcessor().convert(source, {
      name: 'box',
      width: 60,
      height: 60,
      fit: 'contain',
    });
    const meta = await sharp(result.data).metadata();
    expect(meta.width).toBe(60);
    expect(meta.height).toBe(60);
  });
});
