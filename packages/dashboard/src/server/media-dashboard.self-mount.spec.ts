// "Mount it yourself" for the console, against the REAL first-party `@nestjs/authorization`:
// `routes: false` registers no console controller, the providers stay exported, and the host serves
// the console from subclasses of the exported controllers, protected with `@Can(...)`.
import 'reflect-metadata';
import { AuthorizationModule, Can, Policy } from '@nestjs/authorization';
import { Controller, type DynamicModule, Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MediaConsoleActionsController,
  MediaConsoleAuthController,
  MediaConsoleReadController,
  MediaConsoleService,
  MediaDashboardModule,
  MediaDashboardUiController,
} from './index.js';

const STORAGE = Symbol.for('nestjs-media:storage');
const STORE = Symbol.for('nestjs-media:store');
const UPLOADS = Symbol.for('nestjs-media:upload-sessions');

@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      useValue: {
        defaultDisk: 'primary',
        diskNames: () => ['primary'],
        disk: () => ({
          capabilities: { presign: true, multipart: true, publicUrls: false, list: true },
        }),
      },
    },
    { provide: STORE, useValue: null },
    { provide: UPLOADS, useValue: null },
  ],
  exports: [STORAGE, STORE, UPLOADS],
})
class MockMediaModule {}

type User = { role: string };

@Policy()
class ConsolePolicy {
  console(user: User | null): boolean {
    return user?.role === 'admin';
  }
}

// The host's own controllers, at the paths the dashboard was configured with.
@Can(ConsolePolicy, 'console')
@Controller('media')
class ConsolePageController extends MediaDashboardUiController {}

@Can(ConsolePolicy, 'console')
@Controller('media/api')
class ConsoleReadController extends MediaConsoleReadController {}

@Can(ConsolePolicy, 'console')
@Controller('media/api')
class ConsoleActionsController extends MediaConsoleActionsController {}

@Can(ConsolePolicy, 'console')
@Controller('media/api')
class ConsoleAuthController extends MediaConsoleAuthController {}

let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

function running() {
  if (!app) throw new Error('no app booted');
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function boot(
  dashboard: DynamicModule,
  controllers: Array<new (...args: never[]) => unknown>,
): Promise<string> {
  @Module({
    imports: [AuthorizationModule.forRoot(), MockMediaModule, dashboard],
    controllers,
    providers: [ConsolePolicy],
  })
  class AppModule {}

  app = await NestFactory.create(AppModule, { logger: false });
  app.use(
    (req: { headers: Record<string, string>; user?: User }, _res: unknown, next: () => void) => {
      const role = req.headers['x-role'];
      if (role) req.user = { role };
      next();
    },
  );
  await app.listen(0);
  return app.getUrl();
}

const as = (role?: string): RequestInit => (role ? { headers: { 'x-role': role } } : {});

describe('routes: false', () => {
  for (const [name, register] of [
    ['forRoot', () => MediaDashboardModule.forRoot({ actions: true, routes: false })],
    [
      'forRootAsync',
      () => MediaDashboardModule.forRootAsync({ useAuth: () => undefined, routes: false }),
    ],
  ] as const) {
    it(`${name}: mounts no console route, the service still works`, async () => {
      const url = await boot(register(), []);

      expect((await fetch(`${url}/media/api/disks`)).status).toBe(404);
      expect((await fetch(`${url}/media/api/me`)).status).toBe(404);
      expect(running().get(MediaConsoleService)).toBeInstanceOf(MediaConsoleService);
    });
  }
});

describe('console mounted by the host, protected with @Can(...)', () => {
  it('a guest gets 401, a denied user 403, an allowed user through — on every controller', async () => {
    const url = await boot(MediaDashboardModule.forRoot({ actions: true, routes: false }), [
      ConsolePageController,
      ConsoleReadController,
      ConsoleActionsController,
      ConsoleAuthController,
    ]);

    expect((await fetch(`${url}/media/api/disks`)).status).toBe(401);
    expect((await fetch(`${url}/media/api/disks`, as('viewer'))).status).toBe(403);
    const disks = await fetch(`${url}/media/api/disks`, as('admin'));
    expect(disks.status).toBe(200);
    expect(JSON.stringify(await disks.json())).toContain('primary');

    expect((await fetch(`${url}/media/api/me`, as('viewer'))).status).toBe(403);
    expect(await (await fetch(`${url}/media/api/me`, as('admin'))).json()).toEqual({
      authRequired: false,
    });

    expect((await fetch(`${url}/media`, as('viewer'))).status).toBe(403);
    expect((await fetch(`${url}/media`, as('admin'))).status).toBe(404); // reached, not built

    const remove = (role: string) =>
      fetch(`${url}/media/api/disks/primary/object?key=a.txt`, { method: 'DELETE', ...as(role) });
    expect((await remove('viewer')).status).toBe(403);
    expect([401, 403, 404]).not.toContain((await remove('admin')).status);
  });

  it("the subclasses resolve the controllers' @Optional() dependencies (built-in auth reaches them)", async () => {
    const url = await boot(
      MediaDashboardModule.forRoot({
        routes: false,
        auth: { secret: 'x'.repeat(32), login: () => null },
      }),
      [ConsoleReadController, ConsoleAuthController],
    );

    // MEDIA_CONSOLE_AUTH reached the auth subclass (an `@Optional()` dep): it now asks for a login…
    expect((await fetch(`${url}/media/api/me`, as('admin'))).status).toBe(401);
    // …and the read subclass inherits the built-in `MediaConsoleGuard` cookie gate.
    expect((await fetch(`${url}/media/api/disks`, as('admin'))).status).toBe(401);
  });
});
