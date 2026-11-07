// End-to-end against the REAL first-party `@nestjs/authorization`, whose `AuthorizationModule.forRoot()`
// registers a deny-by-default global `AuthorizationGuard`. Every console controller is marked
// `can-anyone`-open; hosts decide who reaches it with `decorators: [Can(...)]`.
import 'reflect-metadata';
import { AuthorizationModule, Can, Policy } from '@nestjs/authorization';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import { CAN_ANYONE_METADATA } from './controller-decorators.js';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleAuthController } from './media-console-auth.controller.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';
import { MediaConsoleGuard } from './media-console.guard.js';
import { MediaDashboardUiController } from './media-dashboard-ui.controller.js';
import { MediaDashboardModule } from './media-dashboard.module.js';

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

let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

async function closeApp(): Promise<void> {
  await app?.close();
  app = undefined;
}

afterEach(closeApp);

async function boot(dashboard: DynamicModule): Promise<string> {
  @Module({
    imports: [AuthorizationModule.forRoot(), MockMediaModule, dashboard],
    providers: [ConsolePolicy],
  })
  class AppModule {}

  app = await NestFactory.create(AppModule, { logger: false });
  // Where an authentication guard would leave the user: `request.user`.
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

describe('can-anyone mark', () => {
  it('is on every console controller', () => {
    for (const controller of [
      MediaDashboardUiController,
      MediaConsoleReadController,
      MediaConsoleActionsController,
      MediaConsoleAuthController,
    ]) {
      expect(Reflect.getMetadata(CAN_ANYONE_METADATA, controller)).toBe(true);
    }
  });
});

describe('with the global AuthorizationGuard and no decorators', () => {
  it('the console answers as before', async () => {
    const url = await boot(MediaDashboardModule.forRoot({ actions: true }));

    expect((await fetch(`${url}/media/api/disks`)).status).toBe(200);
    expect(await (await fetch(`${url}/media/api/me`)).json()).toEqual({ authRequired: false });
    // The page controller is reached: no SPA bundle in this workspace, so its own "not built" 404.
    expect((await fetch(`${url}/media`)).status).toBe(404);
  });

  it('forRootAsync too', async () => {
    const url = await boot(MediaDashboardModule.forRootAsync({ useAuth: () => undefined }));

    expect((await fetch(`${url}/media/api/disks`)).status).toBe(200);
  });
});

describe('decorators: [Can(ConsolePolicy, "console")]', () => {
  for (const [name, register] of [
    [
      'forRoot',
      () =>
        MediaDashboardModule.forRoot({
          actions: true,
          decorators: [Can(ConsolePolicy, 'console')],
        }),
    ],
    [
      'forRootAsync',
      () =>
        MediaDashboardModule.forRootAsync({
          actions: true,
          useAuth: () => undefined,
          decorators: [Can(ConsolePolicy, 'console')],
        }),
    ],
  ] as const) {
    it(`${name}: a guest gets 401, a denied user 403, an allowed user through — on every controller`, async () => {
      const url = await boot(register());

      expect((await fetch(`${url}/media/api/disks`)).status).toBe(401);
      expect((await fetch(`${url}/media/api/disks`, as('viewer'))).status).toBe(403);
      expect((await fetch(`${url}/media/api/disks`, as('admin'))).status).toBe(200);

      expect((await fetch(`${url}/media/api/me`, as('viewer'))).status).toBe(403);
      expect((await fetch(`${url}/media/api/me`, as('admin'))).status).toBe(200);

      expect((await fetch(`${url}/media`, as('viewer'))).status).toBe(403);
      expect((await fetch(`${url}/media`, as('admin'))).status).toBe(404); // reached, not built

      const remove = (role: string) =>
        fetch(`${url}/media/api/disks/primary/object?key=a.txt`, { method: 'DELETE', ...as(role) });
      expect((await remove('viewer')).status).toBe(403);
      expect([401, 403]).not.toContain((await remove('admin')).status);
    });
  }
});

describe('no leakage between registrations', () => {
  it("one registration's decorators never reach the next", async () => {
    const first = await boot(
      MediaDashboardModule.forRoot({ decorators: [Can(ConsolePolicy, 'console')] }),
    );
    expect((await fetch(`${first}/media/api/disks`)).status).toBe(401);
    await closeApp();

    for (const controller of [
      MediaDashboardUiController,
      MediaConsoleReadController,
      MediaConsoleAuthController,
    ]) {
      expect(Reflect.getMetadata('authorization:can', controller)).toBeUndefined();
    }
    expect(Reflect.getOwnMetadata(GUARDS_METADATA, MediaConsoleReadController)).toEqual([
      MediaConsoleGuard,
    ]);

    const second = await boot(MediaDashboardModule.forRoot());
    expect((await fetch(`${second}/media/api/disks`)).status).toBe(200);
    expect((await fetch(`${second}/media/api/me`)).status).toBe(200);
  });
});
