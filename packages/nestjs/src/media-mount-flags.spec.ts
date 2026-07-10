// `mount` is a static, build-time-only escape hatch on `forRootAsync` (see its
// JSDoc on `MediaModuleAsyncOptions`): unlike `tus`/`direct` on `forRoot`, which
// gate mounting by presence of config, `forRootAsync` can't know the resolved
// options in time to decide whether to register a controller — so by default
// it mounts all three and each 501s when unconfigured. `mount: { x: false }`
// drops that controller's routes entirely (a real 404) instead of leaving a
// mounted-but-always-501 controller as dead surface.
import type { AddressInfo } from 'node:net';
import { InMemoryDriver } from '@dudousxd/nestjs-media-testing';
import { NotImplementedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MediaDirectUploadController } from './media-direct-upload.controller';
import { MediaMultipartUploadController } from './media-multipart-upload.controller';
import { MediaUploadController } from './media-upload.controller';
import { MediaModule } from './media.module';

function baseOptions() {
  return { default: 'local', disks: { local: new InMemoryDriver() } };
}

describe('forRootAsync mount flags', () => {
  it('defaults to mounting all three upload controllers (current behavior)', async () => {
    const mod = await Test.createTestingModule({
      imports: [MediaModule.forRootAsync({ useFactory: () => baseOptions() })],
    }).compile();

    expect(mod.get(MediaUploadController)).toBeInstanceOf(MediaUploadController);
    expect(mod.get(MediaMultipartUploadController)).toBeInstanceOf(MediaMultipartUploadController);
    expect(mod.get(MediaDirectUploadController)).toBeInstanceOf(MediaDirectUploadController);

    // Unconfigured (no tus/uploadSessions/direct in the factory result) but still
    // mounted -> 501, not 404.
    await expect(
      mod.get(MediaUploadController).create({ status: () => ({}) as never } as never, {}),
    ).rejects.toThrow(NotImplementedException);
    expect(() => mod.get(MediaDirectUploadController).initiate({ key: 'x' })).toThrow(
      NotImplementedException,
    );
  });

  it('mount: { direct: false } removes the direct controller from the DI container entirely (a route 404, not a 501)', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        MediaModule.forRootAsync({
          useFactory: () => baseOptions(),
          mount: { direct: false },
        }),
      ],
    }).compile();

    expect(mod.get(MediaUploadController)).toBeInstanceOf(MediaUploadController);
    expect(mod.get(MediaMultipartUploadController)).toBeInstanceOf(MediaMultipartUploadController);
    // Not registered at all -> Nest's DI container throws resolving it, exactly
    // like `forRoot` when `direct` is omitted (see media.module.spec.ts).
    expect(() => mod.get(MediaDirectUploadController)).toThrow();
  });

  it('mount: { tus: false, multipart: false } leaves only the direct controller mounted', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        MediaModule.forRootAsync({
          useFactory: () => baseOptions(),
          mount: { tus: false, multipart: false },
        }),
      ],
    }).compile();

    expect(() => mod.get(MediaUploadController)).toThrow();
    expect(() => mod.get(MediaMultipartUploadController)).toThrow();
    expect(mod.get(MediaDirectUploadController)).toBeInstanceOf(MediaDirectUploadController);
  });

  it('an unmounted controller 404s over real HTTP (not 501)', async () => {
    const app = await NestFactory.create<NestExpressApplication>(
      MediaModule.forRootAsync({ useFactory: () => baseOptions(), mount: { direct: false } }),
      { logger: false },
    );
    await app.listen(0);
    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${address.port}/media/uploads/direct/initiate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'x' }),
      });
      expect(res.status).toBe(404);
      expect(res.status).not.toBe(501);
    } finally {
      await app.close();
    }
  });
});
