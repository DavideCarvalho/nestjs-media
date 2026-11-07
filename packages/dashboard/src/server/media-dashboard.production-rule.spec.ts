import { InMemoryDisk, StorageModule } from '@nestjs/storage';
// The safe default: in production, a console that mounts routes with no `decorators` refuses to
// boot. Outside production it mounts them open, as before.
import 'reflect-metadata';
import { Can, Policy } from '@nestjs/authorization';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaConsoleApiModule, MediaConsoleService, MediaDashboardModule } from './index.js';

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

@Policy()
class ConsolePolicy {
  console(): boolean {
    return true;
  }
}

async function boots(dashboard: () => DynamicModule): Promise<void> {
  @Module({ imports: [MockMediaModule, dashboard()], providers: [ConsolePolicy] })
  class AppModule {}
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  expect(app.get(MediaConsoleService)).toBeInstanceOf(MediaConsoleService);
  await app.close();
}

const previous = process.env.NODE_ENV;
afterEach(() => {
  if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
  else process.env.NODE_ENV = previous;
});

describe('in production', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  for (const [name, register] of [
    ['forRoot', () => MediaDashboardModule.forRoot({ actions: true })],
    [
      'forRoot with an empty decorators list',
      () => MediaDashboardModule.forRoot({ decorators: [] }),
    ],
    ['forRootAsync', () => MediaDashboardModule.forRootAsync()],
  ] as const) {
    it(`${name}: undecorated routes refuse to boot, naming both ways to protect them`, () => {
      let error: unknown;
      try {
        register();
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(
        /^MediaDashboardModule\.forRoot(Async)?\(\) mounts routes with no protection/,
      );
      expect(message).toContain('NODE_ENV=production');
      expect(message).toContain(
        "decorators: [UseGuards(AuthenticationGuard), Can(MediaPolicy, 'console')]",
      );
      expect(message).toContain('routes: false');
      expect(message).toContain('extends MediaConsoleReadController');
    });
  }

  it('MediaConsoleApiModule.register follows the same rule', () => {
    const objectUrls = { strategy: 'auto' as const, apiBasePath: '/media/api' };
    expect(() => MediaConsoleApiModule.register({ actions: false, objectUrls })).toThrow(
      /^MediaConsoleApiModule\.register\(\) mounts routes with no protection/,
    );
    expect(
      MediaConsoleApiModule.register({
        actions: false,
        objectUrls,
        decorators: [Can(ConsolePolicy, 'console')],
      }).controllers,
    ).toHaveLength(1);
    expect(
      MediaConsoleApiModule.register({ actions: false, objectUrls, routes: false }).controllers,
    ).toEqual([]);
  });

  it('boots with decorators', async () => {
    await boots(() =>
      MediaDashboardModule.forRoot({ actions: true, decorators: [Can(ConsolePolicy, 'console')] }),
    );
    await boots(() =>
      MediaDashboardModule.forRootAsync({ decorators: [Can(ConsolePolicy, 'console')] }),
    );
  });

  it('boots with routes: false', async () => {
    await boots(() => MediaDashboardModule.forRoot({ routes: false }));
    await boots(() => MediaDashboardModule.forRootAsync({ routes: false }));
  });
});

describe('outside production', () => {
  it('undecorated routes mount open, as before', async () => {
    process.env.NODE_ENV = 'development';
    expect(MediaDashboardModule.forRoot().controllers).toHaveLength(1);
    Reflect.deleteProperty(process.env, 'NODE_ENV');
    await boots(() => MediaDashboardModule.forRoot());
  });
});
