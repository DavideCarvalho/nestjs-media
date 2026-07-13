import 'reflect-metadata';
import {
  type CanActivate,
  type ExecutionContext,
  Global,
  Inject,
  Injectable,
  Module,
} from '@nestjs/common';
import { GUARDS_METADATA as REAL_GUARDS_METADATA } from '@nestjs/common/constants.js';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from './guards.js';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';
import { MediaConsoleGuard } from './media-console.guard.js';
import { MediaDashboardUiController } from './media-dashboard-ui.controller.js';
import { MediaDashboardModule } from './media-dashboard.module.js';

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

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return false;
  }
}

@Injectable()
class AllowGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

@Injectable()
class HostAuthService {
  allowed = true;
}

@Module({ providers: [HostAuthService], exports: [HostAuthService] })
class HostAuthModule {}

@Injectable()
class GuardWithDeps implements CanActivate {
  constructor(@Inject(HostAuthService) private readonly auth: HostAuthService) {}
  canActivate(_context: ExecutionContext): boolean {
    return this.auth.allowed;
  }
}

/** A stub "host session" guard: allows only when `x-host-auth: yes` is present, mirroring a real
 *  app's own cookie/header auth sitting alongside the console's built-in `auth` cookie login. */
@Injectable()
class HeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return request.headers['x-host-auth'] === 'yes';
  }
}

describe('GUARDS_METADATA drift', () => {
  it("stays byte-identical to @nestjs/common's real GUARDS_METADATA constant", () => {
    expect(GUARDS_METADATA).toBe(REAL_GUARDS_METADATA);
  });
});

// Runs FIRST and in its own describe, before any other test in this file stamps a guard onto the
// shared, static controller classes — proving that on a truly pristine boot (the only shape a real
// host ever sees; `forRoot` normally runs once at startup) omitting `guards` reproduces today's
// behavior byte-for-byte: the read/action controllers keep exactly their own `MediaConsoleGuard`,
// and the page controller stays completely unguarded.
describe('MediaDashboardModule.forRoot with no `guards` (pristine boot)', () => {
  it('leaves the controllers exactly as `@UseGuards`/the absence of it left them', () => {
    MediaDashboardModule.forRoot();

    expect(Reflect.getMetadata(REAL_GUARDS_METADATA, MediaDashboardUiController)).toBeUndefined();
    expect(Reflect.getOwnMetadata(REAL_GUARDS_METADATA, MediaConsoleReadController)).toEqual([
      MediaConsoleGuard,
    ]);
    expect(Reflect.getOwnMetadata(REAL_GUARDS_METADATA, MediaConsoleActionsController)).toEqual([
      MediaConsoleGuard,
    ]);
  });

  it('serves the open console exactly as before this feature existed', async () => {
    @Module({
      imports: [
        MockMediaModule,
        MediaDashboardModule.forRoot({ basePath: '/media', apiBasePath: '/api/media/console' }),
      ],
    })
    class AppModule {}

    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api', {
      exclude: ['media', 'media/(.*)', 'api/media/console', 'api/media/console/(.*)'],
    });
    await app.listen(0);
    try {
      const url = await app.getUrl();
      // The page controller itself is reached (no guard blocks it); this test workspace has no
      // built SPA bundle, so the controller's own "not built" 404 is the expected, pre-existing
      // outcome here — the same 404 `media-dashboard.mount.spec.ts` would hit too.
      const page = await fetch(`${url}/media`);
      expect(page.status).toBe(404);

      const api = await fetch(`${url}/api/media/console/disks`);
      expect(api.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe('MediaDashboardModule.forRoot guards (reflect-metadata level)', () => {
  it('stamps the page controller with a plain REPLACE (it has no built-in guard)', () => {
    MediaDashboardModule.forRoot({ guards: [DenyGuard] });

    expect(Reflect.getMetadata(REAL_GUARDS_METADATA, MediaDashboardUiController)).toEqual([
      DenyGuard,
    ]);
  });

  it('APPENDS to (never replaces) the read/action controllers’ built-in MediaConsoleGuard', () => {
    MediaDashboardModule.forRoot({ guards: [DenyGuard] });

    expect(Reflect.getMetadata(REAL_GUARDS_METADATA, MediaConsoleReadController)).toEqual([
      MediaConsoleGuard,
      DenyGuard,
    ]);
    expect(Reflect.getMetadata(REAL_GUARDS_METADATA, MediaConsoleActionsController)).toEqual([
      MediaConsoleGuard,
      DenyGuard,
    ]);
  });

  it('a later forRoot() call recomputes from the pristine base instead of compounding', () => {
    MediaDashboardModule.forRoot({ guards: [DenyGuard] });
    MediaDashboardModule.forRoot({ guards: [AllowGuard] });

    // Exactly [MediaConsoleGuard, AllowGuard] — NOT [MediaConsoleGuard, DenyGuard, AllowGuard].
    expect(Reflect.getMetadata(REAL_GUARDS_METADATA, MediaConsoleReadController)).toEqual([
      MediaConsoleGuard,
      AllowGuard,
    ]);
  });

  it('omitting `guards` leaves every controller’s metadata exactly as it was (byte-for-byte)', () => {
    // Prime both controllers with a stamp from a prior call, then call forRoot() with no guards.
    MediaDashboardModule.forRoot({ guards: [DenyGuard] });
    MediaDashboardModule.forRoot();

    expect(Reflect.getMetadata(REAL_GUARDS_METADATA, MediaDashboardUiController)).toEqual([
      DenyGuard,
    ]);
    expect(Reflect.getMetadata(REAL_GUARDS_METADATA, MediaConsoleReadController)).toEqual([
      MediaConsoleGuard,
      DenyGuard,
    ]);
  });
});

describe('MediaDashboardModule.forRoot guards (integration)', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function boot(dashboardModule: ReturnType<typeof MediaDashboardModule.forRoot>) {
    @Module({ imports: [MockMediaModule, dashboardModule] })
    class AppModule {}

    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api', {
      exclude: ['media', 'media/(.*)', 'api/media/console', 'api/media/console/(.*)'],
    });
    await app.listen(0);
    return app.getUrl();
  }

  it('rejects an anonymous page navigation AND an anonymous API request when a stub guard denies', async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media/console',
        guards: [DenyGuard],
      }),
    );

    const page = await fetch(`${url}/media`);
    expect(page.status).toBe(403);

    const api = await fetch(`${url}/api/media/console/disks`);
    expect(api.status).toBe(403);
  });

  it('serves both surfaces when the stub guard allows', async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media/console',
        guards: [AllowGuard],
      }),
    );

    // AllowGuard lets the request through to the controller itself; this test workspace has no
    // built SPA bundle, so the controller's OWN "not built" 404 is what proves the guard didn't
    // block it (a deny would have 403'd before the controller ever ran) — not a 200.
    const page = await fetch(`${url}/media`);
    expect(page.status).toBe(404);

    const api = await fetch(`${url}/api/media/console/disks`);
    expect(api.status).toBe(200);
  });

  it('a guard WITH a dependency resolves via `imports` on BOTH the page and the API host module', async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media/console',
        guards: [GuardWithDeps],
        imports: [HostAuthModule],
      }),
    );

    // Same "guard let it through" reasoning as above: 404 (unbuilt SPA), not 403.
    const page = await fetch(`${url}/media`);
    expect(page.status).toBe(404);

    const api = await fetch(`${url}/api/media/console/disks`);
    expect(api.status).toBe(200);
  });

  it('does not gate the auth controller that mints the built-in session (still reachable)', async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media/console',
        guards: [DenyGuard],
        auth: {
          secret: 'test-secret',
          login: async (username, password) =>
            username === 'admin' && password === 'pw' ? { id: '1', roles: ['admin'] } : null,
        },
      }),
    );

    // /login is NOT stamped with the host's DenyGuard — it 401s on bad creds (its OWN gate),
    // never the host guard's 403.
    const badLogin = await fetch(`${url}/api/media/console/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    expect(badLogin.status).toBe(401);
  });

  it('the built-in `auth` cookie login and a host guard compose with AND semantics', async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media/console',
        guards: [HeaderGuard],
        auth: {
          secret: 'test-secret',
          login: async (username, password) =>
            username === 'admin' && password === 'pw' ? { id: '1', roles: ['admin'] } : null,
        },
      }),
    );

    // Login is unaffected by the host guard (mints fine without the header).
    const login = await fetch(`${url}/api/media/console/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pw' }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const cookie = setCookie?.split(';')[0];

    // Valid console session, but WITHOUT the host header: MediaConsoleGuard passes, HeaderGuard
    // denies -> still rejected.
    const cookieOnly = await fetch(`${url}/api/media/console/disks`, {
      headers: { cookie: cookie ?? '' },
    });
    expect(cookieOnly.status).toBe(403);

    // The host header, but NO console session: HeaderGuard passes, MediaConsoleGuard denies (401)
    // -> still rejected.
    const headerOnly = await fetch(`${url}/api/media/console/disks`, {
      headers: { 'x-host-auth': 'yes' },
    });
    expect(headerOnly.status).toBe(401);

    // Both satisfied -> allowed.
    const both = await fetch(`${url}/api/media/console/disks`, {
      headers: { cookie: cookie ?? '', 'x-host-auth': 'yes' },
    });
    expect(both.status).toBe(200);
  });
});
