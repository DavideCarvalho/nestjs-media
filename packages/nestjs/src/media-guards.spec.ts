// Guards run in Nest's ExecutionContext pipeline, which only fires over a real
// HTTP request — calling a controller method directly (as most other specs in
// this package do) bypasses guards entirely. So these tests boot a real
// `NestExpressApplication` (in-memory disk/session store, no docker) and drive
// it with `fetch`, mirroring the HTTP style already used by
// `parallel-upload-e2e.db.spec.ts`.
import type { AddressInfo } from 'node:net';
import { InMemoryDriver, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaDirectUploadController } from './media-direct-upload.controller';
import { MediaMultipartUploadController } from './media-multipart-upload.controller';
import { MediaUploadController } from './media-upload.controller';
import { MediaModule, type MediaModuleOptions } from './media.module';

const TOKEN = 'let-me-in';

/** Rejects unless `x-test-token` matches; otherwise indistinguishable from a
 * real bearer-token auth guard a consumer would write. */
@Injectable()
class TokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    if (request.headers['x-test-token'] !== TOKEN) {
      throw new UnauthorizedException('missing or bad token');
    }
    return true;
  }
}

/** Always denies — used to prove the guard actually gates the route at all. */
@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    throw new ForbiddenException('nope');
  }
}

let app: NestExpressApplication | undefined;

async function boot(options: MediaModuleOptions): Promise<string> {
  app = await NestFactory.create<NestExpressApplication>(MediaModule.forRoot(options), {
    logger: false,
  });
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function bootAsync(
  useFactory: () => MediaModuleOptions,
  guards?: Parameters<typeof MediaModule.forRootAsync>[0]['guards'],
): Promise<string> {
  app = await NestFactory.create<NestExpressApplication>(
    MediaModule.forRootAsync({ useFactory, ...(guards ? { guards } : {}) }),
    { logger: false },
  );
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function tusOptions() {
  return {
    default: 'local',
    disks: { local: new InMemoryDriver() },
    uploadSessions: new InMemoryUploadSessionStore(),
    tus: { disk: 'local', basePath: '/media/uploads' },
  } satisfies MediaModuleOptions;
}

const b64 = (s: string) => Buffer.from(s).toString('base64');

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('guards option — forRoot', () => {
  it('with no guards, the upload surface stays open (current default behavior)', async () => {
    const baseUrl = await boot(tusOptions());

    const res = await fetch(`${baseUrl}/media/uploads`, {
      method: 'POST',
      headers: { 'upload-length': '5', 'upload-metadata': `filename ${b64('a.txt')}` },
    });

    expect(res.status).toBe(201);
  });

  it('rejects a tus route request that fails the guard', async () => {
    const baseUrl = await boot({ ...tusOptions(), guards: [TokenGuard] });

    const res = await fetch(`${baseUrl}/media/uploads`, {
      method: 'POST',
      headers: { 'upload-length': '5', 'upload-metadata': `filename ${b64('a.txt')}` },
    });

    expect(res.status).toBe(401);
  });

  it('allows a tus route request that passes the guard', async () => {
    const baseUrl = await boot({ ...tusOptions(), guards: [TokenGuard] });

    const res = await fetch(`${baseUrl}/media/uploads`, {
      method: 'POST',
      headers: {
        'upload-length': '5',
        'upload-metadata': `filename ${b64('a.txt')}`,
        'x-test-token': TOKEN,
      },
    });

    expect(res.status).toBe(201);
  });

  it('rejects a multipart route request that fails the guard', async () => {
    const baseUrl = await boot({ ...tusOptions(), guards: [TokenGuard] });

    const res = await fetch(`${baseUrl}/media/uploads/some-id/parts/1`, { method: 'PUT' });

    expect(res.status).toBe(401);
  });

  it('lets a multipart route request through the guard (reaches the handler)', async () => {
    const baseUrl = await boot({ ...tusOptions(), guards: [TokenGuard] });

    const res = await fetch(`${baseUrl}/media/uploads/some-id/parts/1`, {
      method: 'PUT',
      headers: { 'x-test-token': TOKEN },
    });

    // Guard passed (not a 401); the handler itself now blows up on the
    // malformed body (no raw-body parser mounted in this test app, so
    // `req.body` isn't the Buffer the controller expects) — proving the
    // request made it all the way past the guard into
    // MediaMultipartUploadController rather than being rejected at the gate.
    expect(res.status).not.toBe(401);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('a guard that always denies blocks the route entirely', async () => {
    const baseUrl = await boot({ ...tusOptions(), guards: [DenyGuard] });

    const res = await fetch(`${baseUrl}/media/uploads`, {
      method: 'POST',
      headers: { 'upload-length': '5', 'upload-metadata': `filename ${b64('a.txt')}` },
    });

    expect(res.status).toBe(403);
  });
});

describe('guards option — forRootAsync (static field)', () => {
  it('applies guards even though options are resolved async', async () => {
    const baseUrl = await bootAsync(() => tusOptions(), [TokenGuard]);

    const denied = await fetch(`${baseUrl}/media/uploads`, {
      method: 'POST',
      headers: { 'upload-length': '5', 'upload-metadata': `filename ${b64('a.txt')}` },
    });
    expect(denied.status).toBe(401);

    const allowed = await fetch(`${baseUrl}/media/uploads`, {
      method: 'POST',
      headers: {
        'upload-length': '5',
        'upload-metadata': `filename ${b64('a.txt')}`,
        'x-test-token': TOKEN,
      },
    });
    expect(allowed.status).toBe(201);
  });

  it('no guards on forRootAsync stays open, same as forRoot', async () => {
    const baseUrl = await bootAsync(() => tusOptions());

    const res = await fetch(`${baseUrl}/media/uploads`, {
      method: 'POST',
      headers: { 'upload-length': '5', 'upload-metadata': `filename ${b64('a.txt')}` },
    });

    expect(res.status).toBe(201);
  });
});

describe('guards metadata replaces rather than accumulates across registrations', () => {
  it('a later forRoot() call with fewer/no guards overrides an earlier one on the shared controller classes', () => {
    MediaModule.forRoot({ ...tusOptions(), guards: [TokenGuard, DenyGuard] });
    expect(Reflect.getMetadata(GUARDS_METADATA, MediaUploadController)).toEqual([
      TokenGuard,
      DenyGuard,
    ]);

    MediaModule.forRoot({ ...tusOptions(), guards: [TokenGuard] });
    expect(Reflect.getMetadata(GUARDS_METADATA, MediaUploadController)).toEqual([TokenGuard]);

    MediaModule.forRoot(tusOptions());
    expect(Reflect.getMetadata(GUARDS_METADATA, MediaUploadController)).toEqual([]);
    expect(Reflect.getMetadata(GUARDS_METADATA, MediaMultipartUploadController)).toEqual([]);
    expect(Reflect.getMetadata(GUARDS_METADATA, MediaDirectUploadController)).toEqual([]);
  });
});
