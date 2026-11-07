// End-to-end against the REAL first-party `@nestjs/authorization`: its `AuthorizationModule.forRoot()`
// registers a deny-by-default global `AuthorizationGuard`, so every controller this package mounts
// is marked `can-anyone`-open, and hosts gate it with `decorators: [Can(...)]` instead.
import type { AddressInfo } from 'node:net';
import { InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { AuthorizationModule, Can, Policy } from '@nestjs/authorization';
import {
  type CanActivate,
  type DynamicModule,
  type ExecutionContext,
  Injectable,
  Module,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { InMemoryDisk, StorageModule } from '@nestjs/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { CAN_ANYONE_METADATA } from './controller-decorators';
import { MediaDirectUploadController } from './media-direct-upload.controller';
import { MediaMultipartUploadController } from './media-multipart-upload.controller';
import { MediaUploadController } from './media-upload.controller';
import { MediaModule, type MediaModuleOptions } from './media.module';

type User = { role: string };

@Policy()
class MediaPolicy {
  upload(user: User | null): boolean {
    return user?.role === 'uploader';
  }
}

/** Rejects unless `x-test-token: ok` — a stand-in for an authentication guard. */
@Injectable()
class TokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    if (request.headers['x-test-token'] !== 'ok') throw new UnauthorizedException();
    return true;
  }
}

let app: NestExpressApplication | undefined;

async function closeApp(): Promise<void> {
  await app?.close();
  app = undefined;
}

afterEach(closeApp);

async function boot(media: DynamicModule): Promise<string> {
  @Module({
    imports: [
      StorageModule.forRoot({ disks: { local: new InMemoryDisk() } }),
      AuthorizationModule.forRoot(),
      media,
    ],
    providers: [MediaPolicy],
  })
  class AppModule {}

  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  // Where an authentication guard would leave the user: `request.user`.
  app.use(
    (req: { headers: Record<string, string>; user?: User }, _res: unknown, next: () => void) => {
      const role = req.headers['x-role'];
      if (role) req.user = { role };
      next();
    },
  );
  await app.listen(0);
  return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
}

function options(): MediaModuleOptions {
  return {
    uploadSessions: new InMemoryUploadSessionStore(),
    tus: { disk: 'local', basePath: '/media/uploads' },
    direct: { disk: 'local' },
  };
}

function createUpload(baseUrl: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/media/uploads`, {
    method: 'POST',
    headers: {
      'upload-length': '5',
      'upload-metadata': `filename ${Buffer.from('a.txt').toString('base64')}`,
      ...headers,
    },
  });
}

describe('can-anyone mark', () => {
  it('is the exact key the real Can.Anyone() writes (drift check for the inlined literal)', () => {
    class Probe {}
    Can.Anyone()(Probe);
    expect(Reflect.getOwnMetadataKeys(Probe)).toEqual([CAN_ANYONE_METADATA]);
  });

  it('is on every upload controller', () => {
    for (const controller of [
      MediaUploadController,
      MediaMultipartUploadController,
      MediaDirectUploadController,
    ]) {
      expect(Reflect.getMetadata(CAN_ANYONE_METADATA, controller)).toBe(true);
    }
  });
});

describe('with the global AuthorizationGuard and no decorators', () => {
  it('forRoot: the upload routes answer as before', async () => {
    const baseUrl = await boot(MediaModule.forRoot(options()));

    expect((await createUpload(baseUrl)).status).toBe(201);
    // Multipart + direct are reached too (the handler answers, not the authorization guard).
    const part = await fetch(`${baseUrl}/media/uploads/missing/parts/1`, { method: 'PUT' });
    expect([401, 403]).not.toContain(part.status);
    const direct = await fetch(`${baseUrl}/media/uploads/direct/initiate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'a.txt' }),
    });
    expect([401, 403]).not.toContain(direct.status);
  });

  it('forRootAsync: the upload routes answer as before', async () => {
    const baseUrl = await boot(MediaModule.forRootAsync({ useFactory: () => options() }));

    expect((await createUpload(baseUrl)).status).toBe(201);
  });
});

describe('decorators: [Can(MediaPolicy, "upload")]', () => {
  for (const [name, register] of [
    [
      'forRoot',
      () => MediaModule.forRoot({ ...options(), decorators: [Can(MediaPolicy, 'upload')] }),
    ],
    [
      'forRootAsync',
      () =>
        MediaModule.forRootAsync({
          useFactory: () => options(),
          decorators: [Can(MediaPolicy, 'upload')],
        }),
    ],
  ] as const) {
    it(`${name}: a guest gets 401, a denied user 403, an allowed user through`, async () => {
      const baseUrl = await boot(register());

      expect((await createUpload(baseUrl)).status).toBe(401);
      expect((await createUpload(baseUrl, { 'x-role': 'viewer' })).status).toBe(403);
      expect((await createUpload(baseUrl, { 'x-role': 'uploader' })).status).toBe(201);
      // Applied to every mounted controller, not just tus.
      const part = await fetch(`${baseUrl}/media/uploads/missing/parts/1`, {
        method: 'PUT',
        headers: { 'x-role': 'viewer' },
      });
      expect(part.status).toBe(403);
      const direct = await fetch(`${baseUrl}/media/uploads/direct/initiate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-role': 'viewer' },
        body: JSON.stringify({ key: 'a.txt' }),
      });
      expect(direct.status).toBe(403);
    });
  }

  it('UseGuards(...) and Can(...) compose: both must pass', async () => {
    const baseUrl = await boot(
      MediaModule.forRoot({
        ...options(),
        decorators: [UseGuards(TokenGuard), Can(MediaPolicy, 'upload')],
      }),
    );

    expect((await createUpload(baseUrl, { 'x-role': 'uploader' })).status).toBe(401);
    expect((await createUpload(baseUrl, { 'x-test-token': 'ok', 'x-role': 'viewer' })).status).toBe(
      403,
    );
    expect(
      (await createUpload(baseUrl, { 'x-test-token': 'ok', 'x-role': 'uploader' })).status,
    ).toBe(201);
  });
});

describe('no leakage between registrations', () => {
  it("one registration's decorators never reach the next", async () => {
    const first = await boot(
      MediaModule.forRoot({
        ...options(),
        decorators: [Can(MediaPolicy, 'upload'), UseGuards(TokenGuard)],
      }),
    );
    expect((await createUpload(first)).status).toBe(401);
    await closeApp();

    // The shared classes were never decorated…
    expect(Reflect.getMetadata('authorization:can', MediaUploadController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, MediaUploadController)).toBeUndefined();

    // …so a registration without decorators is open again.
    const second = await boot(MediaModule.forRoot(options()));
    expect((await createUpload(second)).status).toBe(201);
  });
});
