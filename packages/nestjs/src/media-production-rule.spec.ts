// The safe default: in production, an upload module that mounts routes with no `decorators` refuses
// to boot. Outside production it mounts them open, as before.
import { InMemoryUploadSessionStore } from '@dudousxd/nestjs-media-testing';
import { Can, Policy } from '@nestjs/authorization';
import { type DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InMemoryDisk, StorageModule } from '@nestjs/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaModule, type MediaModuleOptions } from './media.module';
import { MediaService } from './media.service';

@Policy()
class MediaPolicy {
  upload(): boolean {
    return true;
  }
}

function options(): MediaModuleOptions {
  return {
    uploadSessions: new InMemoryUploadSessionStore(),
    tus: { disk: 'local' },
    direct: { disk: 'local' },
  };
}

async function boots(media: () => DynamicModule): Promise<void> {
  @Module({
    imports: [StorageModule.forRoot({ disks: { local: new InMemoryDisk() } }), media()],
    providers: [MediaPolicy],
  })
  class AppModule {}
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  // The providers still work whatever is mounted.
  expect(app.get(MediaService)).toBeInstanceOf(MediaService);
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
    ['forRoot', () => MediaModule.forRoot(options())],
    [
      'forRoot with an empty decorators list',
      () => MediaModule.forRoot({ ...options(), decorators: [] }),
    ],
    ['forRootAsync', () => MediaModule.forRootAsync({ useFactory: () => options() })],
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
      expect(message).toMatch(/^MediaModule\.forRoot(Async)?\(\) mounts routes with no protection/);
      expect(message).toContain('NODE_ENV=production');
      expect(message).toContain(
        "decorators: [UseGuards(AuthenticationGuard), Can(MediaPolicy, 'upload')]",
      );
      expect(message).toContain('routes: false');
      expect(message).toContain('extends MediaUploadController');
    });
  }

  it('boots with decorators', async () => {
    await boots(() =>
      MediaModule.forRoot({ ...options(), decorators: [Can(MediaPolicy, 'upload')] }),
    );
    await boots(() =>
      MediaModule.forRootAsync({
        useFactory: () => options(),
        decorators: [Can(MediaPolicy, 'upload')],
      }),
    );
  });

  it('boots with routes: false', async () => {
    await boots(() => MediaModule.forRoot({ ...options(), routes: false }));
    await boots(() => MediaModule.forRootAsync({ useFactory: () => options(), routes: false }));
  });

  it('boots when every surface is turned off or unconfigured: nothing is mounted', async () => {
    await boots(() =>
      MediaModule.forRoot({ ...options(), mount: { tus: false, multipart: false, direct: false } }),
    );
    await boots(() => MediaModule.forRoot({}));
  });
});

describe('outside production', () => {
  it('undecorated routes mount open, as before', async () => {
    process.env.NODE_ENV = 'development';
    expect(MediaModule.forRoot(options()).controllers).toHaveLength(3);
    process.env.NODE_ENV = 'test';
    expect(MediaModule.forRootAsync({ useFactory: () => options() }).controllers).toHaveLength(3);
    Reflect.deleteProperty(process.env, 'NODE_ENV');
    await boots(() => MediaModule.forRoot(options()));
  });
});
