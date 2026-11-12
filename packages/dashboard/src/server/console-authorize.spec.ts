import 'reflect-metadata';
import { AuthorizationModule, Policy } from '@nestjs/authorization';
import { type ExecutionContext, Injectable, Logger, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONSOLE_AUTHORIZE_MISSING_WARNING,
  type ConsoleAuthorize,
  type ConsoleAuthorizer,
  authorizeByToken,
  normalizeConsoleResult,
  resolveConsoleAuthorize,
} from './console-authorize.js';

/** A minimal HTTP ExecutionContext over a fake request. */
function ctx(request: { headers?: Record<string, string>; user?: unknown; url?: string } = {}) {
  const req = { headers: {}, ...request };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getClass: () => Object,
    getHandler: () => () => undefined,
    getArgs: () => [req],
  } as unknown as ExecutionContext;
}

@Injectable()
class AuditService {
  readonly seen: string[] = [];
}

@Injectable()
class ConsoleAccess implements ConsoleAuthorizer {
  static created = 0;
  constructor(private readonly audit: AuditService) {
    ConsoleAccess.created++;
  }
  authorize(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<{ user?: { admin?: boolean } }>().user;
    this.audit.seen.push('checked');
    return user?.admin === true;
  }
}

async function moduleRefWith(
  providers: unknown[] = [],
  imports: unknown[] = [],
): Promise<ModuleRef> {
  const ref = await Test.createTestingModule({
    imports: imports as never[],
    providers: [AuditService, ...(providers as never[])],
  }).compile();
  return ref.get(ModuleRef);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeConsoleResult', () => {
  it.each([
    [true, { allowed: true }],
    [{ allowed: true }, { allowed: true }],
    [false, { allowed: false, reason: 'forbidden' }],
    [{ allowed: false }, { allowed: false, reason: 'forbidden' }],
    [
      { allowed: false, reason: 'forbidden' },
      { allowed: false, reason: 'forbidden' },
    ],
    [
      { allowed: false, reason: 'unauthenticated' },
      { allowed: false, reason: 'unauthenticated' },
    ],
    [{ redirectTo: '/login' }, { allowed: false, reason: 'unauthenticated', redirectTo: '/login' }],
    [undefined, { allowed: false, reason: 'forbidden' }],
    ['yes', { allowed: false, reason: 'forbidden' }],
  ])('%j → %j', (result, decision) => {
    expect(normalizeConsoleResult(result)).toEqual(decision);
  });

  it('returns a fresh object every time (no shared denial singleton)', () => {
    for (const result of [true, false, { allowed: false, reason: 'unauthenticated' }]) {
      const first = normalizeConsoleResult(result);
      const second = normalizeConsoleResult(result);
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
    }
  });
});

describe('resolveConsoleAuthorize', () => {
  describe('omitted', () => {
    const env = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = env;
    });

    it('open outside production, warning once with the exact text', async () => {
      process.env.NODE_ENV = 'development';
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const check = await resolveConsoleAuthorize(undefined, await moduleRefWith());
      expect(await check(ctx())).toEqual({ allowed: true });
      expect(await check(ctx())).toEqual({ allowed: true });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[@dudousxd/nestjs-media-dashboard] console has no `authorize` configured: it is open outside production and denies every request in production. Set `authorize` in MediaDashboardModule.forRoot().',
      );
      expect(CONSOLE_AUTHORIZE_MISSING_WARNING).toBe(warn.mock.calls[0]?.[0]);
    });

    it('forbidden in production, a fresh object per request', async () => {
      process.env.NODE_ENV = 'production';
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const check = await resolveConsoleAuthorize(undefined, await moduleRefWith());
      const first = await check(ctx());
      expect(first).toEqual({ allowed: false, reason: 'forbidden' });
      expect(await check(ctx())).not.toBe(first);
    });
  });

  it('inline function: called with the context', async () => {
    const check = await resolveConsoleAuthorize(
      (c) => c.switchToHttp().getRequest<{ user?: { admin: boolean } }>().user?.admin === true,
      await moduleRefWith(),
    );
    expect(await check(ctx({ user: { admin: true } }))).toEqual({ allowed: true });
    expect(await check(ctx())).toEqual({ allowed: false, reason: 'forbidden' });
  });

  it('async function returning every result shape', async () => {
    let next: unknown = { redirectTo: '/login' };
    const check = await resolveConsoleAuthorize(async () => next as never, await moduleRefWith());
    expect(await check(ctx())).toEqual({
      allowed: false,
      reason: 'unauthenticated',
      redirectTo: '/login',
    });
    next = { allowed: false, reason: 'unauthenticated' };
    expect(await check(ctx())).toEqual({ allowed: false, reason: 'unauthenticated' });
  });

  it('class: created through DI once per registration (constructor injection works)', async () => {
    ConsoleAccess.created = 0;
    const moduleRef = await moduleRefWith();
    const check = await resolveConsoleAuthorize(ConsoleAccess, moduleRef);
    expect(await check(ctx({ user: { admin: true } }))).toEqual({ allowed: true });
    expect(await check(ctx())).toEqual({ allowed: false, reason: 'forbidden' });
    expect(ConsoleAccess.created).toBe(1);
  });

  it('class: a registered provider is used as-is', async () => {
    ConsoleAccess.created = 0;
    const moduleRef = await moduleRefWith([ConsoleAccess]);
    const registered = moduleRef.get(ConsoleAccess);
    const check = await resolveConsoleAuthorize(ConsoleAccess, moduleRef);
    await check(ctx({ user: { admin: true } }));
    expect(ConsoleAccess.created).toBe(1);
    expect((moduleRef.get(AuditService) as AuditService).seen).toHaveLength(1);
    expect(registered).toBeInstanceOf(ConsoleAccess);
  });

  it('lazy import: the import runs once, the class goes through DI', async () => {
    ConsoleAccess.created = 0;
    const load = vi.fn(async () => ({ default: ConsoleAccess }));
    const check = await resolveConsoleAuthorize(load, await moduleRefWith());
    expect(await check(ctx({ user: { admin: true } }))).toEqual({ allowed: true });
    expect(await check(ctx())).toEqual({ allowed: false, reason: 'forbidden' });
    expect(await check(ctx({ user: { admin: true } }))).toEqual({ allowed: true });
    expect(load).toHaveBeenCalledTimes(1);
    expect(ConsoleAccess.created).toBe(1);
  });

  it('a throw anywhere is a forbidden denial, logged at warn', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const check = await resolveConsoleAuthorize(
      () => {
        throw new Error('boom');
      },
      await moduleRefWith(),
    );
    expect(await check(ctx())).toEqual({ allowed: false, reason: 'forbidden' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));

    @Injectable()
    class Broken implements ConsoleAuthorizer {
      authorize(): boolean {
        throw new Error('class boom');
      }
    }
    const fromClass = await resolveConsoleAuthorize(Broken, await moduleRefWith());
    expect(await fromClass(ctx())).toEqual({ allowed: false, reason: 'forbidden' });

    const lazy = await resolveConsoleAuthorize(
      () => Promise.reject(new Error('import failed')),
      await moduleRefWith(),
    );
    expect(await lazy(ctx())).toEqual({ allowed: false, reason: 'forbidden' });
  });

  describe('gate name', () => {
    const GATE = Symbol.for('@dudousxd/aviary:console-gate');

    it('asks the console-gate provider', async () => {
      const allows = vi.fn(async (name: string, c: ExecutionContext) =>
        name === 'console.media'
          ? c.switchToHttp().getRequest<{ user?: unknown }>().user !== undefined
          : false,
      );
      const check = await resolveConsoleAuthorize(
        'console.media',
        await moduleRefWith([{ provide: GATE, useValue: { allows } }]),
      );
      expect(await check(ctx({ user: {} }))).toEqual({ allowed: true });
      expect(await check(ctx())).toEqual({ allowed: false, reason: 'forbidden' });
      expect(allows).toHaveBeenCalledWith('console.media', expect.anything());
    });

    it('with no gate provider, fails at boot with a clear message', async () => {
      await expect(resolveConsoleAuthorize('console.media', await moduleRefWith())).rejects.toThrow(
        "`authorize: 'console.media'` needs @dudousxd/nestjs-authz's AuthzModule (it resolves gate names); or pass a function, a class, or { policy, ability }",
      );
    });
  });

  describe('policy (real @nestjs/authorization)', () => {
    type User = { role: string };

    @Policy()
    class ConsolePolicy {
      view(user: User | null): boolean {
        return user?.role === 'admin';
      }
    }

    it('allow / unauthenticated with no user / forbidden with a user', async () => {
      const moduleRef = await moduleRefWith(
        [],
        [AuthorizationModule.forRoot({ policies: [ConsolePolicy], globalGuard: false })],
      );
      const check = await resolveConsoleAuthorize(
        { policy: ConsolePolicy, ability: 'view' },
        moduleRef,
      );
      expect(await check(ctx({ user: { role: 'admin' } }))).toEqual({ allowed: true });
      expect(await check(ctx({ user: { role: 'viewer' } }))).toEqual({
        allowed: false,
        reason: 'forbidden',
      });
      expect(await check(ctx())).toEqual({ allowed: false, reason: 'unauthenticated' });
    });

    it("uses the module's getUser", async () => {
      @Module({})
      class Empty {}
      const moduleRef = await moduleRefWith(
        [],
        [
          Empty,
          AuthorizationModule.forRoot({
            policies: [ConsolePolicy],
            globalGuard: false,
            getUser: (c: ExecutionContext) =>
              c.switchToHttp().getRequest<{ headers: Record<string, string> }>().headers['x-role']
                ? {
                    role: c.switchToHttp().getRequest<{ headers: Record<string, string> }>()
                      .headers['x-role'],
                  }
                : null,
          } as never),
        ],
      );
      const check = await resolveConsoleAuthorize(
        { policy: ConsolePolicy, ability: 'view' },
        moduleRef,
      );
      expect(await check(ctx({ headers: { 'x-role': 'admin' } }))).toEqual({ allowed: true });
      expect(await check(ctx())).toEqual({ allowed: false, reason: 'unauthenticated' });
    });

    it('a null or false user is a guest: the policy sees null, the denial is unauthenticated', async () => {
      const seen: unknown[] = [];
      @Policy()
      class Recording {
        view(user: unknown): boolean {
          seen.push(user);
          return false;
        }
      }
      const moduleRef = await moduleRefWith(
        [],
        [AuthorizationModule.forRoot({ policies: [Recording], globalGuard: false })],
      );
      const check = await resolveConsoleAuthorize(
        { policy: Recording, ability: 'view' },
        moduleRef,
      );
      expect(await check(ctx({ user: null }))).toEqual({
        allowed: false,
        reason: 'unauthenticated',
      });
      expect(await check(ctx({ user: false }))).toEqual({
        allowed: false,
        reason: 'unauthenticated',
      });
      expect(seen).toEqual([null, null]);
    });

    it('without AuthorizationModule imported, fails at boot with a tailored message', async () => {
      await expect(
        resolveConsoleAuthorize({ policy: ConsolePolicy, ability: 'view' }, await moduleRefWith()),
      ).rejects.toThrow(
        '`authorize: { policy, ability }` needs AuthorizationModule.forRoot() from @nestjs/authorization imported in the app',
      );
    });
  });
});

describe('authorizeByToken', () => {
  const byToken = authorizeByToken({ token: 's3cret' }) as (c: ExecutionContext) => unknown;

  it('allows a matching Bearer header', () => {
    expect(byToken(ctx({ headers: { authorization: 'Bearer s3cret' } }))).toBe(true);
  });

  it('a mismatch, a missing header, or another scheme is unauthenticated', () => {
    for (const headers of [
      { authorization: 'Bearer wrong' },
      { authorization: 'Bearer s3cret2' },
      { authorization: 'Basic s3cret' },
      {},
    ]) {
      expect(byToken(ctx({ headers }))).toEqual({ allowed: false, reason: 'unauthenticated' });
    }
  });

  it('ignores ?token= and custom headers', () => {
    expect(
      byToken(
        ctx({ url: '/media/api/disks?token=s3cret', headers: { 'x-console-token': 's3cret' } }),
      ),
    ).toEqual({ allowed: false, reason: 'unauthenticated' });
  });

  it('an empty or missing token throws at config time', () => {
    expect(() => authorizeByToken({ token: '' })).toThrow('authorizeByToken: `token` is empty');
    expect(() => authorizeByToken({ token: undefined })).toThrow(
      'authorizeByToken: `token` is empty',
    );
  });

  it('is a ConsoleAuthorize', async () => {
    const authorize: ConsoleAuthorize = authorizeByToken({ token: 's3cret' });
    const check = await resolveConsoleAuthorize(authorize, await moduleRefWith());
    expect(await check(ctx({ headers: { authorization: 'Bearer s3cret' } }))).toEqual({
      allowed: true,
    });
  });
});
