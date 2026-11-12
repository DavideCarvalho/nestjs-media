import { AsyncLocalStorage } from 'node:async_hooks';
import type { AddressInfo } from 'node:net';
import type { MediaTenancyOption, MediaTenantFilter } from '@dudousxd/nestjs-media-core';
import { InMemoryMediaStore } from '@dudousxd/nestjs-media-testing';
import { Controller, Get, Global, Module, Param, Req, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { InMemoryDisk, StorageModule } from '@nestjs/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaModule, type MediaTenancyScope } from './media.module';
import { MediaService } from './media.service';
import { MEDIA_TENANCY } from './tokens';

/** A structural stand-in for `@dudousxd/nestjs-context`'s accessor, scoped per request. */
const requestFilter = new AsyncLocalStorage<MediaTenantFilter>();
function fakeAccessor(enabled: boolean) {
  return {
    tenancy: () => ({ enabled }),
    tenantFilter: (): MediaTenantFilter => requestFilter.getStore() ?? { mode: 'system' },
  };
}
const as = <T>(tenant: string | null, fn: () => T): T =>
  requestFilter.run(
    tenant === null
      ? { mode: 'tenantless' }
      : { mode: 'tenant', tenant: { id: tenant, kind: 'organization', source: 'app' } },
    fn,
  );

const SLOT = Symbol.for('@dudousxd/nestjs-diagnostics:accessor');
const slots = globalThis as unknown as Record<symbol, { current?: unknown } | undefined>;

let app: NestExpressApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  delete slots[SLOT];
});

@Controller('files')
class FilesController {
  constructor(private readonly media: MediaService) {}

  @Get(':id')
  file(@Param('id') id: string, @Req() req: unknown, @Res({ passthrough: true }) res: unknown) {
    return this.media.serve(id, undefined, { req, res });
  }
}

async function boot(options: {
  context: 'provider' | 'slot' | 'none';
  enabled?: boolean;
  tenancy?: MediaTenancyOption;
  store?: InMemoryMediaStore;
  authorize?: () => void;
}) {
  const accessor = fakeAccessor(options.enabled ?? true);
  if (options.context === 'slot') slots[SLOT] = { current: accessor };
  @Global()
  @Module({
    providers: [{ provide: Symbol.for('@dudousxd/nestjs-context:accessor'), useValue: accessor }],
    exports: [Symbol.for('@dudousxd/nestjs-context:accessor')],
  })
  class FakeContextModule {}
  @Module({
    imports: [
      ...(options.context === 'provider' ? [FakeContextModule] : []),
      StorageModule.forRoot({ disks: { local: new InMemoryDisk() } }),
      MediaModule.forRoot({
        store: options.store ?? new InMemoryMediaStore(),
        ...(options.tenancy !== undefined ? { tenancy: options.tenancy } : {}),
        ...(options.authorize ? { authorize: options.authorize } : {}),
      }),
    ],
    controllers: [FilesController],
  })
  class AppModule {}
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  // What the app's auth guard + `Context.setTenant` would do: the tenant comes from the request.
  app.use((req: { headers: Record<string, string> }, _res: unknown, next: () => void) => {
    const tenant = req.headers['x-tenant'];
    if (tenant === undefined) return next();
    as(tenant === 'none' ? null : tenant, next);
  });
  await app.listen(0);
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const media = app.get(MediaService);
  const attach = (tenant: string | null) =>
    as(tenant, () =>
      media.library.attach({
        ownerType: 'Post',
        ownerId: '1',
        collection: 'docs',
        fileName: 'hello.txt',
        mimeType: 'text/plain',
        contents: Buffer.from('hello'),
      }),
    );
  const get = (id: string, tenant: string) =>
    fetch(`${base}/files/${id}`, { headers: { 'x-tenant': tenant } }).then((r) => r.status);
  return { media, attach, get };
}

describe('MediaModule tenancy', () => {
  for (const context of ['provider', 'slot'] as const) {
    it(`scopes serve/url/list by the request tenant (accessor from ${context}); others get 404`, async () => {
      const authorize = vi.fn();
      const { media, attach, get } = await boot({ context, authorize });
      const t1 = await attach('t1');
      const none = await attach(null);
      expect(t1.tenantId).toBe('t1');
      expect(none.tenantId).toBeNull();

      expect(await get(t1.id, 't1')).toBe(200);
      expect(await get(t1.id, 't2')).toBe(404);
      expect(await get(t1.id, 'none')).toBe(404);
      expect(await get(none.id, 'none')).toBe(200);
      expect(await get(none.id, 't1')).toBe(404);
      // Hidden records are not-found before `authorize` runs: it saw only the visible reads.
      expect(authorize).toHaveBeenCalledTimes(2);

      await expect(as('t2', () => media.url(t1.id))).rejects.toMatchObject({ status: 404 });
      expect((await as('t1', () => media.library.list('Post', '1'))).map((r) => r.id)).toEqual([
        t1.id,
      ]);
      // A delete from another tenant is a no-op, as for a missing record.
      await as('t2', () => media.delete(t1.id));
      expect(await get(t1.id, 't1')).toBe(200);
    });
  }

  it('exposes the request scope to the dashboard under MEDIA_TENANCY', async () => {
    await boot({ context: 'provider', tenancy: { nullRows: 'shared' } });
    const scope = app?.get<MediaTenancyScope>(MEDIA_TENANCY);
    expect(await as('t1', () => scope?.match())).toEqual({ id: 't1', orNull: true });
    expect(await as(null, () => scope?.match())).toEqual({ id: null });
    expect(await scope?.match()).toBeUndefined(); // system
    expect(await as('t1', () => scope?.canSee('t2'))).toBe(false);
  });

  describe('tenancy off is identical', () => {
    const cases = [
      { name: 'context tenancy disabled', context: 'provider', enabled: false },
      { name: '`tenancy: false` with context tenancy on', context: 'provider', tenancy: false },
      { name: 'no context at all', context: 'none' },
    ] as const;
    for (const c of cases) {
      it(c.name, async () => {
        const store = new InMemoryMediaStore();
        const enable = vi.spyOn(store, 'enableTenancy');
        const { attach, get } = await boot({ ...c, store });
        const record = await attach('t1');
        expect(record).not.toHaveProperty('tenantId');
        expect(await get(record.id, 't2')).toBe(200);
        expect(enable).not.toHaveBeenCalled();
        const scope = app?.get<MediaTenancyScope>(MEDIA_TENANCY);
        expect(await as('t2', () => scope?.match())).toBeUndefined();
      });
    }
  });

  it('fails the boot with the fix when the store has no tenant column', async () => {
    const store = new InMemoryMediaStore();
    vi.spyOn(store, 'enableTenancy').mockRejectedValue(
      Object.assign(new Error('Media tenancy is on, but the `media` table has no `tenant_id`'), {
        name: 'MediaTenancyUnavailableError',
      }),
    );
    await expect(boot({ context: 'provider', store })).rejects.toThrow(
      'the `media` table has no `tenant_id`',
    );
  });
});
