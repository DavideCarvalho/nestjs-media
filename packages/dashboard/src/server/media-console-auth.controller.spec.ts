import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { MediaDashboardModule } from './index.js';

const STORAGE = Symbol.for('nestjs-media:storage');
const STORE = Symbol.for('nestjs-media:store');
const UPLOADS = Symbol.for('nestjs-media:upload-sessions');

const fakeStorage = {
  defaultDisk: 'primary',
  diskNames: () => ['primary'],
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

async function boot(dashboardModule: ReturnType<typeof MediaDashboardModule.forRoot>) {
  @Module({ imports: [MockMediaModule, dashboardModule] })
  class AppModule {}

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api', {
    exclude: ['media', 'media/(.*)', 'api/media/console', 'api/media/console/(.*)'],
  });
  await app.listen(0);
  return { app, url: await app.getUrl() };
}

// Password is OPTIONAL end-to-end: nothing above the `login` hook rejects an empty string, since
// some hosts gate on username alone (e.g. email must be an active admin) and deliberately ignore
// the password. These lock that pass-through in at the controller boundary.
describe('MediaConsoleAuthController — empty password pass-through', () => {
  it('passes an empty password through to the hook verbatim', async () => {
    const login = vi.fn(() => ({ id: 'admin', roles: ['admin'] }));
    const { app, url } = await boot(
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media/console',
        auth: { secret: 'test-secret', login },
      }),
    );
    try {
      const res = await fetch(`${url}/api/media/console/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: '' }),
      });
      expect(res.status).toBe(200);
      expect(login).toHaveBeenCalledWith('admin', '');
    } finally {
      await app.close();
    }
  });

  it('still uniform-fails (401) when the hook rejects an empty password', async () => {
    const { app, url } = await boot(
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media/console',
        auth: {
          secret: 'test-secret',
          login: (username, password) => (password === '' ? null : { id: username }),
        },
      }),
    );
    try {
      const res = await fetch(`${url}/api/media/console/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: '' }),
      });
      expect(res.status).toBe(401);
      expect((await res.json()).message).toBe('Invalid credentials');
    } finally {
      await app.close();
    }
  });

  it('mints the session when the hook accepts an empty password (email-only gate)', async () => {
    const { app, url } = await boot(
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media/console',
        auth: {
          secret: 'test-secret',
          login: (username) =>
            username === 'admin@example.com' ? { id: username, roles: ['admin'] } : null,
        },
      }),
    );
    try {
      const login = await fetch(`${url}/api/media/console/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin@example.com', password: '' }),
      });
      expect(login.status).toBe(200);
      const setCookie = login.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      const cookie = setCookie?.split(';')[0];

      const disks = await fetch(`${url}/api/media/console/disks`, {
        headers: { cookie: cookie ?? '' },
      });
      expect(disks.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});
