import { InMemoryDisk, StorageModule } from '@nestjs/storage';
// The console's `authorize` over HTTP: every console controller (page, assets, read and action
// APIs) is gated; denials answer 403/401 JSON for API calls, and a redirect or an "Access denied"
// page for browser navigations. With no `authorize`: open outside production, 403 in production,
// one warning at boot. `decorators` don't count as `authorize`.
import 'reflect-metadata';
import {
  type CanActivate,
  Controller,
  type DynamicModule,
  type ExecutionContext,
  Global,
  Injectable,
  Logger,
  Module,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConsoleAuthorizeFilter,
  ConsoleAuthorizeGuard,
  type ConsoleAuthorizeResult,
  type ConsoleAuthorizer,
  MediaConsoleApiModule,
  MediaConsoleReadController,
  MediaDashboardModule,
  authorizeByToken,
} from './index.js';

const STORE = Symbol.for('nestjs-media:store');
const UPLOADS = Symbol.for('nestjs-media:upload-sessions');

@Global()
@Module({
  imports: [StorageModule.forRoot({ disks: { primary: new InMemoryDisk() } })],
  providers: [
    { provide: STORE, useValue: null },
    { provide: UPLOADS, useValue: null },
  ],
  exports: [STORE, UPLOADS],
})
class MockMediaModule {}

type User = { role: string };
type Req = { headers: Record<string, string | undefined>; user?: User };

/** The app's authentication guard: what sets `request.user`, from a header standing in for a cookie. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Req>();
    const role = req.headers['x-role'];
    if (role) req.user = { role };
    return true;
  }
}

let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

async function boot(dashboard: DynamicModule, extra: { controllers?: never[] } = {}) {
  @Module({ imports: [MockMediaModule, dashboard], controllers: extra.controllers ?? [] })
  class AppModule {}
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  return app.getUrl();
}

const page = (role?: string): RequestInit => ({
  redirect: 'manual',
  headers: { accept: 'text/html,application/xhtml+xml', ...(role ? { 'x-role': role } : {}) },
});
const api = (role?: string): RequestInit => ({
  redirect: 'manual',
  headers: { accept: 'application/json', ...(role ? { 'x-role': role } : {}) },
});

/** admin → allowed, viewer → forbidden, guest → unauthenticated or a login redirect. */
function byRole(guest: ConsoleAuthorizeResult) {
  return (ctx: ExecutionContext): ConsoleAuthorizeResult => {
    const user = ctx.switchToHttp().getRequest<Req>().user;
    if (!user) return guest;
    return user.role === 'admin';
  };
}

describe('authorize', () => {
  it('gates every console controller: allowed / 403 / 401', async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({
        actions: true,
        decorators: [UseGuards(FakeAuthGuard)],
        authorize: byRole({ allowed: false, reason: 'unauthenticated' }),
      }),
    );

    const disks = await fetch(`${url}/media/api/disks`, api('admin'));
    expect(disks.status).toBe(200);

    const forbidden = await fetch(`${url}/media/api/disks`, api('viewer'));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: 'forbidden' });

    const guest = await fetch(`${url}/media/api/disks`, api());
    expect(guest.status).toBe(401);
    expect(await guest.json()).toEqual({ error: 'unauthenticated' });

    const remove = (role?: string) =>
      fetch(`${url}/media/api/disks/primary/object?key=a.txt`, { method: 'DELETE', ...api(role) });
    expect((await remove('viewer')).status).toBe(403);
    expect([401, 403]).not.toContain((await remove('admin')).status);

    // The page controller and its assets.
    expect((await fetch(`${url}/media`, page('admin'))).status).toBe(404); // reached, not built
    expect((await fetch(`${url}/media/assets/x.js`, api('viewer'))).status).toBe(403);
    expect((await fetch(`${url}/media/assets/x.js`, api('admin'))).status).toBe(404);
  });

  it('a forbidden page navigation gets an "Access denied" page', async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({
        decorators: [UseGuards(FakeAuthGuard)],
        authorize: byRole(false),
      }),
    );
    const res = await fetch(`${url}/media`, page('viewer'));
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Access denied');
  });

  it('redirectTo: 302 for a page navigation, 401 JSON with redirectTo for the API', async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({
        decorators: [UseGuards(FakeAuthGuard)],
        authorize: byRole({ redirectTo: '/login?next=/media' }),
      }),
    );

    const nav = await fetch(`${url}/media`, page());
    expect(nav.status).toBe(302);
    expect(nav.headers.get('location')).toBe('/login?next=/media');

    const call = await fetch(`${url}/media/api/disks`, api());
    expect(call.status).toBe(401);
    expect(await call.json()).toEqual({
      error: 'unauthenticated',
      redirectTo: '/login?next=/media',
    });

    // A page-controller asset (not an HTML navigation) gets the JSON too.
    expect((await fetch(`${url}/media/assets/x.js`, api())).status).toBe(401);
  });

  it('a throwing authorize is a 403', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const url = await boot(
      MediaDashboardModule.forRoot({
        authorize: () => {
          throw new Error('db down');
        },
      }),
    );
    expect((await fetch(`${url}/media/api/disks`, api())).status).toBe(403);
  });

  it('class form, through DI', async () => {
    @Injectable()
    class ConsoleAccess implements ConsoleAuthorizer {
      authorize(ctx: ExecutionContext) {
        return ctx.switchToHttp().getRequest<Req>().user?.role === 'admin';
      }
    }
    const url = await boot(
      MediaDashboardModule.forRootAsync({
        decorators: [UseGuards(FakeAuthGuard)],
        authorize: ConsoleAccess,
      }),
    );
    expect((await fetch(`${url}/media/api/disks`, api('admin'))).status).toBe(200);
    expect((await fetch(`${url}/media/api/disks`, api('viewer'))).status).toBe(403);
  });

  it('authorizeByToken: Bearer header only', async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({ authorize: authorizeByToken({ token: 't0k' }) }),
    );
    const bearer = { headers: { authorization: 'Bearer t0k' } };
    expect((await fetch(`${url}/media/api/disks`, bearer)).status).toBe(200);
    expect(
      (await fetch(`${url}/media/api/disks`, { headers: { authorization: 'Bearer no' } })).status,
    ).toBe(401);
    expect((await fetch(`${url}/media/api/disks?token=t0k`)).status).toBe(401);
  });

  it('MediaConsoleApiModule.register takes authorize too', async () => {
    const url = await boot(
      MediaConsoleApiModule.register({
        actions: false,
        objectUrls: { strategy: 'auto', apiBasePath: '' },
        authorize: () => false,
      }),
    );
    expect((await fetch(`${url}/disks`, api())).status).toBe(403);
  });

  it('routes: false — the exported guard and filter protect a self-mounted controller', async () => {
    @UseGuards(FakeAuthGuard, ConsoleAuthorizeGuard)
    @UseFilters(ConsoleAuthorizeFilter)
    @Controller('mine/api')
    class MyConsoleApi extends MediaConsoleReadController {}

    const url = await boot(
      MediaDashboardModule.forRoot({
        routes: false,
        authorize: byRole({ allowed: false, reason: 'unauthenticated' }),
      }),
      { controllers: [MyConsoleApi as never] },
    );
    expect((await fetch(`${url}/mine/api/disks`, api('admin'))).status).toBe(200);
    expect((await fetch(`${url}/mine/api/disks`, api('viewer'))).status).toBe(403);
    expect((await fetch(`${url}/mine/api/disks`, api())).status).toBe(401);
    expect((await fetch(`${url}/media/api/disks`, api('admin'))).status).toBe(404);
  });
});

describe('authorize omitted', () => {
  const previous = process.env.NODE_ENV;
  afterEach(() => {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else process.env.NODE_ENV = previous;
  });

  const WARNING =
    '[@dudousxd/nestjs-media-dashboard] console has no `authorize` configured: it is open outside production and denies every request in production. Set `authorize` in MediaDashboardModule.forRoot().';

  it('outside production: open, and one warning at boot', async () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const url = await boot(MediaDashboardModule.forRoot({ actions: true }));
    expect((await fetch(`${url}/media/api/disks`, api())).status).toBe(200);
    expect((await fetch(`${url}/media`, page())).status).toBe(404); // reached, not built
    expect(warn.mock.calls.filter(([m]) => m === WARNING)).toHaveLength(1);
  });

  describe('in production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    for (const [name, register, module] of [
      [
        'forRoot',
        () => MediaDashboardModule.forRoot({ actions: true }),
        'MediaDashboardModule.forRoot',
      ],
      [
        'forRootAsync',
        () => MediaDashboardModule.forRootAsync({ actions: true }),
        'MediaDashboardModule.forRootAsync',
      ],
      [
        'decorators only (an auth guard is not authorize)',
        () =>
          MediaDashboardModule.forRoot({ actions: true, decorators: [UseGuards(FakeAuthGuard)] }),
        'MediaDashboardModule.forRoot',
      ],
    ] as const) {
      it(`${name}: boots, every request is 403, the warning is logged exactly once`, async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const url = await boot(register());

        const res = await fetch(`${url}/media/api/disks`, api('admin'));
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'forbidden' });
        expect(
          (await fetch(`${url}/media/api/disks/primary/object?key=a`, { method: 'DELETE' })).status,
        ).toBe(403);
        expect((await fetch(`${url}/media`, page('admin'))).status).toBe(403);
        expect((await fetch(`${url}/media/assets/x.js`)).status).toBe(403);

        const warnings = warn.mock.calls.filter(
          ([m]) => typeof m === 'string' && m.includes('no `authorize`'),
        );
        expect(warnings).toEqual([[WARNING.replace('MediaDashboardModule.forRoot', module)]]);
      });
    }

    it('with authorize, production serves normally', async () => {
      const url = await boot(MediaDashboardModule.forRoot({ authorize: () => true }));
      expect((await fetch(`${url}/media/api/disks`, api())).status).toBe(200);
    });

    it('no longer refuses to boot', () => {
      expect(() => MediaDashboardModule.forRoot()).not.toThrow();
      expect(() =>
        MediaConsoleApiModule.register({
          actions: false,
          objectUrls: { strategy: 'auto', apiBasePath: '/media/api' },
        }),
      ).not.toThrow();
    });
  });
});
