import { InMemoryMediaStore, storageOf } from '@dudousxd/nestjs-media-testing';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { NotFoundException, NotImplementedException } from '@nestjs/common';
import { InMemoryDisk } from '@nestjs/storage';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { normalizeConsoleResult } from './console-authorize.js';
import {
  CONSOLE_APPS,
  MediaConsoleAppInterceptor,
  type MediaConsoleFederation,
  assertValidFederation,
  currentFederatedApp,
  describeFederation,
  grantedApps,
  selectedAppName,
  withMediaConsoleScope,
} from './federation.js';
import { MediaConsoleService } from './media-console.service.js';

const federation: MediaConsoleFederation = {
  apps: {
    orders: { store: new InMemoryMediaStore(), label: 'Orders' },
    billing: { store: new InMemoryMediaStore() },
  },
};

describe('selectedAppName', () => {
  it('reads the header first, then ?app=, ignoring empty values', () => {
    expect(selectedAppName({ headers: { 'x-media-app': 'a' }, query: { app: 'b' } })).toBe('a');
    expect(selectedAppName({ headers: { 'x-media-app': '' }, query: { app: 'b' } })).toBe('b');
    expect(selectedAppName({ headers: { 'x-media-app': ['c', 'd'] } })).toBe('c');
    expect(selectedAppName({ headers: {}, query: { app: ['x'] } })).toBeUndefined();
    expect(selectedAppName(undefined)).toBeUndefined();
  });
});

describe('grants', () => {
  it('an allow keeps its `apps` grant; a list confines, `*` or none is every app', () => {
    expect(normalizeConsoleResult({ allowed: true, apps: ['a', 3, ''] })).toEqual({
      allowed: true,
      apps: ['a'],
    });
    expect(normalizeConsoleResult({ allowed: true, apps: '*' })).toEqual({
      allowed: true,
      apps: '*',
    });
    expect(normalizeConsoleResult(true)).toEqual({ allowed: true });
    expect(grantedApps('*')).toBeUndefined();
    expect(grantedApps(undefined)).toBeUndefined();
    expect(grantedApps(['a'])).toEqual(['a']);
  });

  it('describes the apps a grant may select, and hides the own app under a list', () => {
    expect(describeFederation(federation, undefined, undefined)).toEqual({
      local: { label: 'this app' },
      apps: [
        { name: 'orders', label: 'Orders' },
        { name: 'billing', label: 'billing' },
      ],
    });
    expect(describeFederation(federation, ['billing'], 'billing')).toEqual({
      local: null,
      apps: [{ name: 'billing', label: 'billing' }],
      current: 'billing',
    });
  });
});

describe('assertValidFederation', () => {
  it('accepts a valid one and nothing', () => {
    expect(() => assertValidFederation(undefined)).not.toThrow();
    expect(() => assertValidFederation(federation)).not.toThrow();
  });

  it('refuses a bad shape, name, app or label', () => {
    expect(() => assertValidFederation({ apps: [] as never })).toThrow(/must be an object/);
    expect(() =>
      assertValidFederation({ apps: { 'x/y': { store: new InMemoryMediaStore() } } }),
    ).toThrow(/must be 1–100/);
    expect(() => assertValidFederation({ apps: { a: {} } })).toThrow(/at least one of/);
    expect(() =>
      assertValidFederation({ apps: { a: { store: new InMemoryMediaStore(), label: '' } } }),
    ).toThrow(/label/);
  });
});

function context(request: Record<string | symbol, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const seen: CallHandler = { handle: () => of(currentFederatedApp()?.name ?? 'own') };

describe('MediaConsoleAppInterceptor', () => {
  it('runs the handler for the selected app, or the own one without a selection', async () => {
    const interceptor = new MediaConsoleAppInterceptor(federation);
    const run = (request: Record<string | symbol, unknown>) =>
      lastValueFrom(interceptor.intercept(context(request), seen));
    expect(await run({ headers: {}, query: { app: 'orders' } })).toBe('orders');
    expect(await run({ headers: { 'x-media-app': 'billing' } })).toBe('billing');
    expect(await run({ headers: {} })).toBe('own');
  });

  it('404s an unknown app, an inherited property, and an app outside the grant', () => {
    const interceptor = new MediaConsoleAppInterceptor(federation);
    for (const request of [
      { headers: {}, query: { app: 'nope' } },
      { headers: {}, query: { app: 'constructor' } },
      { headers: { 'x-media-app': 'billing' }, [CONSOLE_APPS]: ['orders'] },
    ]) {
      expect(() => interceptor.intercept(context(request), seen)).toThrow(NotFoundException);
    }
  });

  it('is a no-op without federation', async () => {
    const interceptor = new MediaConsoleAppInterceptor(null);
    const out = interceptor.intercept(context({ headers: {}, query: { app: 'orders' } }), seen);
    expect(await lastValueFrom(out)).toBe('own');
  });
});

describe('MediaConsoleService under a federated scope', () => {
  const own = new InMemoryMediaStore();
  const ordersDisk = new InMemoryDisk();
  const apps: MediaConsoleFederation = {
    apps: {
      orders: { store: new InMemoryMediaStore(), storage: storageOf({ files: ordersDisk }) },
    },
  };
  const service = new MediaConsoleService(
    storageOf({ files: new InMemoryDisk() }),
    own,
    null,
    true,
    null,
    { strategy: 'proxy', apiBasePath: '/media/api' },
  );
  const inOrders = <T>(fn: () => T, grant?: readonly string[]): T =>
    withMediaConsoleScope(
      { federation: apps, grant, app: { name: 'orders', ...apps.apps.orders } },
      fn,
    );

  it('a proxied object URL carries the app, so <img src> reaches the same app', async () => {
    await ordersDisk.put('a.txt', 'x');
    const detail = await inOrders(() => service.objectDetail('files', 'a.txt'));
    expect(detail.url).toBe('/media/api/disks/files/object/raw?key=a.txt&app=orders');
  });

  it('refuses disk writes for a federated app with a 501', async () => {
    await expect(inOrders(() => service.deleteObject('files', 'a.txt'))).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    await expect(inOrders(() => service.createFolder('files', 'x'))).rejects.toBeInstanceOf(
      NotImplementedException,
    );
    expect(await ordersDisk.exists('a.txt')).toBe(true);
  });

  it("the console's own app is hidden from a viewer whose grant is a list", async () => {
    await expect(
      withMediaConsoleScope({ federation: apps, grant: ['orders'] }, () => service.listLibrary({})),
    ).rejects.toBeInstanceOf(NotFoundException);
    const topology = withMediaConsoleScope({ federation: apps, grant: ['orders'] }, () =>
      service.topology(),
    );
    expect(topology).toMatchObject({ hasStore: false, federation: { local: null } });
  });
});
