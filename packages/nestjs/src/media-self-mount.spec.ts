// "Mount it yourself", end to end against the REAL first-party `@nestjs/authorization`:
// `MediaModule.forRoot({ mount: false })` mounts no upload controller, every provider still works,
// and the developer serves the same routes from controllers of their own — subclasses of the
// exported controller classes — protected with ordinary `@Can(...)` decorators under the official
// deny-by-default global `AuthorizationGuard`.
import type { AddressInfo } from 'node:net';
import { InMemoryDriver, InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { AuthorizationModule, Can, Policy } from '@nestjs/authorization';
import { Controller, type DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaDirectUploadController } from './media-direct-upload.controller';
import { MediaMultipartUploadController } from './media-multipart-upload.controller';
import { MediaUploadController } from './media-upload.controller';
import { MediaModule, type MediaModuleOptions } from './media.module';
import { MediaService } from './media.service';

type User = { role: string };

@Policy()
class MediaPolicy {
  upload(user: User | null): boolean {
    return user?.role === 'uploader';
  }
}

// The developer's own controllers, at a path of their choosing, protected the ordinary Nest way.
@Can(MediaPolicy, 'upload')
@Controller('api/uploads')
class UploadsController extends MediaUploadController {}

@Can(MediaPolicy, 'upload')
@Controller('api/uploads')
class UploadPartsController extends MediaMultipartUploadController {}

@Can(MediaPolicy, 'upload')
@Controller('api/uploads/direct')
class DirectUploadsController extends MediaDirectUploadController {}

let app: NestExpressApplication | undefined;

function running() {
  if (!app) throw new Error('no app booted');
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function options(): MediaModuleOptions {
  return {
    default: 'local',
    disks: { local: new InMemoryDriver() },
    uploadSessions: new InMemoryUploadSessionStore(),
    // `basePath` is what the tus Location header points at: the developer's own mount.
    tus: { disk: 'local', basePath: '/api/uploads', keyFor: (filename) => `uploads/${filename}` },
    direct: { disk: 'local' },
    mount: false,
  };
}

async function boot(media: DynamicModule, controllers: Array<new (...args: never[]) => unknown>) {
  @Module({
    imports: [AuthorizationModule.forRoot(), media],
    controllers,
    providers: [MediaPolicy],
  })
  class AppModule {}

  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.use(express.raw({ type: 'application/offset+octet-stream' }));
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

function createUpload(baseUrl: string, path: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'tus-resumable': '1.0.0',
      'upload-length': '5',
      'upload-metadata': `filename ${Buffer.from('a.txt').toString('base64')}`,
      ...headers,
    },
  });
}

describe('mount: false', () => {
  for (const [name, register] of [
    ['forRoot', () => MediaModule.forRoot(options())],
    ['forRootAsync', () => MediaModule.forRootAsync({ useFactory: options, mount: false })],
  ] as const) {
    it(`${name}: mounts no upload route, every provider still works`, async () => {
      const baseUrl = await boot(register(), []);

      expect((await createUpload(baseUrl, '/media/uploads')).status).toBe(404);
      const part = await fetch(`${baseUrl}/media/uploads/x/parts/1`, { method: 'PUT' });
      expect(part.status).toBe(404);
      const direct = await fetch(`${baseUrl}/media/uploads/direct/initiate`, { method: 'POST' });
      expect(direct.status).toBe(404);

      const media = running().get(MediaService);
      await media.disk().put('hello.txt', Buffer.from('hi'));
      expect((await media.disk().get('hello.txt')).toString()).toBe('hi');
      expect(media.uploads).toBeDefined();
      expect(media.directUploads).toBeDefined();
    });
  }

  it('the object form still drops single surfaces on forRoot', async () => {
    const baseUrl = await boot(
      MediaModule.forRoot({ ...options(), tus: { disk: 'local' }, mount: { direct: false } }),
      [],
    );

    expect((await createUpload(baseUrl, '/media/uploads')).status).toBe(201);
    const direct = await fetch(`${baseUrl}/media/uploads/direct/initiate`, { method: 'POST' });
    expect(direct.status).toBe(404);
  });
});

describe('upload routes mounted by the developer, protected with @Can(...)', () => {
  it('a guest gets 401, a denied user 403, an allowed user uploads a file', async () => {
    const baseUrl = await boot(MediaModule.forRoot(options()), [
      UploadsController,
      UploadPartsController,
      DirectUploadsController,
    ]);

    // The library's default mount is gone; the developer's is the only one.
    expect((await createUpload(baseUrl, '/media/uploads')).status).toBe(404);

    expect((await createUpload(baseUrl, '/api/uploads')).status).toBe(401);
    expect((await createUpload(baseUrl, '/api/uploads', { 'x-role': 'viewer' })).status).toBe(403);

    // A real tus upload through the developer's controller: create, then PATCH the bytes.
    const created = await createUpload(baseUrl, '/api/uploads', { 'x-role': 'uploader' });
    expect(created.status).toBe(201);
    const location = created.headers.get('location');
    expect(location).toMatch(/^\/api\/uploads\/.+/);

    const patched = await fetch(`${baseUrl}${location}`, {
      method: 'PATCH',
      headers: {
        'x-role': 'uploader',
        'tus-resumable': '1.0.0',
        'upload-offset': '0',
        'content-type': 'application/offset+octet-stream',
      },
      body: Buffer.from('hello'),
    });
    expect(patched.status).toBe(204);
    expect(patched.headers.get('upload-offset')).toBe('5');

    // The last byte completes the upload: the file is on the disk.
    const media = running().get(MediaService);
    expect((await media.disk().get('uploads/a.txt')).toString()).toBe('hello');

    // The multipart and direct subclasses are protected the same way.
    const part = await fetch(`${baseUrl}/api/uploads/missing/parts/1`, {
      method: 'PUT',
      headers: { 'x-role': 'viewer' },
    });
    expect(part.status).toBe(403);
    const direct = await fetch(`${baseUrl}/api/uploads/direct/initiate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'a.txt' }),
    });
    expect(direct.status).toBe(401);
  });

  it('works with forRootAsync too', async () => {
    const baseUrl = await boot(MediaModule.forRootAsync({ useFactory: options, mount: false }), [
      UploadsController,
    ]);

    expect((await createUpload(baseUrl, '/api/uploads')).status).toBe(401);
    expect((await createUpload(baseUrl, '/api/uploads', { 'x-role': 'uploader' })).status).toBe(
      201,
    );
  });
});
