import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { MediaDashboardModule } from './index.js';

const STORAGE = Symbol.for('nestjs-media:storage');
const STORE = Symbol.for('nestjs-media:store');
const UPLOADS = Symbol.for('nestjs-media:upload-sessions');

const fakeStorage = {
  defaultDisk: 'primary',
  diskNames: () => ['primary', 'secondary'],
  disk: () => ({ capabilities: { presign: true, multipart: true, publicUrls: false, list: true } }),
};

@Global()
@Module({
  providers: [
    { provide: STORAGE, useValue: fakeStorage },
    { provide: STORE, useValue: null },
    { provide: UPLOADS, useValue: null },
  ],
  exports: [STORAGE, STORE, UPLOADS],
})
class MockMediaModule {}

@Module({
  imports: [
    MockMediaModule,
    MediaDashboardModule.forRoot({
      basePath: '/media',
      apiBasePath: '/api/media/console',
      actions: false,
    }),
  ],
})
class AppModule {}

describe('MediaDashboardModule mount (bootstrap smoke)', () => {
  it('boots, serves the read API, and 404s a gated action route', async () => {
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api', {
      exclude: ['media', 'media/(.*)', 'api/media/console', 'api/media/console/(.*)'],
    });
    await app.listen(0);
    const url = await app.getUrl();
    try {
      const topo = await fetch(`${url}/api/media/console/topology`);
      expect(topo.status).toBe(200);
      expect(await topo.json()).toEqual({
        hasStore: false,
        hasUploads: false,
        disks: 2,
        actions: false,
      });

      const disks = await fetch(`${url}/api/media/console/disks`);
      expect(disks.status).toBe(200);
      const disksBody = await disks.json();
      expect(disksBody.disks).toHaveLength(2);

      const gated = await fetch(`${url}/api/media/console/disks/primary/object?key=x`, {
        method: 'DELETE',
      });
      expect(gated.status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
