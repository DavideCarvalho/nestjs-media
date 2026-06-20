import type {
  ConversionPreset,
  ConversionResult,
  ImageProcessor,
} from '@dudousxd/nestjs-media-core';
import sharp from 'sharp';

const CONTENT_TYPE: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

export class SharpImageProcessor implements ImageProcessor {
  async convert(input: Buffer, preset: ConversionPreset): Promise<ConversionResult> {
    let pipeline = sharp(input);

    if (preset.width || preset.height) {
      pipeline = pipeline.resize({
        ...(preset.width ? { width: preset.width } : {}),
        ...(preset.height ? { height: preset.height } : {}),
        fit: preset.fit ?? 'cover',
      });
    }

    const format = preset.format ?? 'webp';
    pipeline = pipeline.toFormat(format, preset.quality ? { quality: preset.quality } : {});

    const data = await pipeline.toBuffer();
    return { data, format, contentType: CONTENT_TYPE[format] ?? 'application/octet-stream' };
  }
}
