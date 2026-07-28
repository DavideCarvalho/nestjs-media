import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConsoleAuthOptions } from './auth/config.js';
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

const SECRET = 's'.repeat(32);

/** Express `Response` surface the hooks use; the spec never imports Express itself. */
interface HostResponse {
  status(code: number): HostResponse;
  type(value: string): HostResponse;
  send(body: string): unknown;
}

async function boot(auth: ConsoleAuthOptions) {
  @Module({
    imports: [
      MockMediaModule,
      MediaDashboardModule.forRoot({
        basePath: '/media',
        apiBasePath: '/api/media/console',
        auth,
      }),
    ],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule, { logger: false });
  // A real listening server (not supertest, which this package does not depend on) — the DI wiring
  // under test only resolves in a fully bootstrapped app.
  await app.listen(0);
  return { app, url: await app.getUrl() };
}

/**
 * The /media console's auth screen lives inside the published React bundle, so — unlike durable and
 * agent — there is no server-rendered page for a host to replace. `auth.unauthenticatedPage`
 * therefore hooks the SPA SHELL route: an unauthenticated navigation gets the host's page instead
 * of the bundle, which also stops the bundle loading at all for a visitor with no session.
 *
 * Assertions key off whether the HOST's page was served, never off the SPA's own markup: the
 * controller resolves the bundle relative to `dist/server` (`spaDir()`), so running from `src` under
 * vitest there is no bundle to serve and the built-in branch answers 404 rather than the shell. That
 * is an artifact of the test layout, not behavior worth pinning — what every case below actually
 * cares about is whether the hook fired.
 */
/** Marker asserted absent whenever the hook must NOT have fired. */
const NOT_SERVED = (status: number, body: string, marker: string) => {
  expect(status).not.toBe(401);
  expect(body).not.toContain(marker);
};
describe('MediaDashboardModule — auth.unauthenticatedPage', () => {
  let booted: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    await booted?.app.close();
    booted = undefined;
  });

  it('serves the host page at the console URL instead of the SPA shell', async () => {
    booted = await boot({
      secret: SECRET,
      session: () => null,
      unauthenticatedPage: ({ response }) => {
        (response as HostResponse)
          .status(401)
          .type('html')
          .send('<html><body>Open /media from the control panel</body></html>');
      },
    });

    const page = await fetch(`${booted.url}/media`);
    expect(page.status).toBe(401);
    const body = await page.text();
    expect(body).toContain('Open /media from the control panel');
    // The bundle must not be referenced at all — the point is that it never loads for a visitor
    // with no session (the SPA shell injects `__MEDIA_API__` into its head).
    expect(body).not.toContain('__MEDIA_API__');
  });

  it('receives basePath and the live request/response', async () => {
    let seen: { basePath: string; hasRequest: boolean } | undefined;
    booted = await boot({
      secret: SECRET,
      session: () => null,
      unauthenticatedPage: ({ request: req, response, basePath }) => {
        seen = { basePath, hasRequest: typeof (req as { url?: unknown })?.url === 'string' };
        (response as HostResponse).status(401).send('ok');
      },
    });

    expect((await fetch(`${booted.url}/media`)).status).toBe(401);
    expect(seen).toEqual({ basePath: '/media', hasRequest: true });
  });

  it('serves the SPA to a visitor who already has a valid session', async () => {
    booted = await boot({
      secret: SECRET,
      session: () => ({ id: 'ops', roles: ['admin'] }),
      unauthenticatedPage: ({ response }) => {
        (response as HostResponse).status(401).send('locked');
      },
    });
    // Mint through the real Mode A endpoint, then navigate carrying only the cookie — exactly what
    // a host launcher does. The hook must NOT fire for a signed-in operator.
    const mint = await fetch(`${booted.url}/api/media/console/session`, { method: 'POST' });
    // media's mint answers 200 with the session body (telescope/durable/agent answer 204).
    expect(mint.status).toBe(200);
    const cookieHeader = (mint.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ');

    const page = await fetch(`${booted.url}/media`, { headers: { cookie: cookieHeader } });
    NOT_SERVED(page.status, await page.text(), 'locked');
  });

  it('is ignored under Mode B, where the SPA login form is the way in', async () => {
    booted = await boot({
      secret: SECRET,
      login: () => ({ id: 'ops' }),
      unauthenticatedPage: ({ response }) => {
        (response as HostResponse).status(401).send('should never render');
      },
    });

    // Gating the shell under Mode B would lock the host out of its own console: the login form the
    // visitor needs is INSIDE the bundle this page would replace.
    const page = await fetch(`${booted.url}/media`);
    NOT_SERVED(page.status, await page.text(), 'should never render');
  });

  it('does not gate the shell when no hook is configured (unchanged behavior)', async () => {
    booted = await boot({ secret: SECRET, session: () => null });

    // No hook => the route must behave exactly as it did before this feature: it goes straight to
    // the SPA branch without consulting any session.
    const page = await fetch(`${booted.url}/media`);
    expect(page.status).not.toBe(401);
  });

  it('falls back to the SPA when the host page throws', async () => {
    booted = await boot({
      secret: SECRET,
      session: () => null,
      unauthenticatedPage: () => {
        throw new Error('template blew up');
      },
    });

    // A broken host page must not turn a navigation into a 500. Falling back is safe because every
    // data route stays behind MediaConsoleGuard — the visitor gets the built-in auth screen, not
    // the console's contents.
    const page = await fetch(`${booted.url}/media`);
    expect(page.status).not.toBe(500);
    expect(page.status).not.toBe(401);
  });

  it('falls back to the SPA when the host page writes nothing', async () => {
    booted = await boot({ secret: SECRET, session: () => null, unauthenticatedPage: () => {} });

    // Otherwise the request hangs until the browser gives up, with nothing logged anywhere. The
    // request completing at all is the assertion; falling through to the SPA branch is the fallback.
    const page = await fetch(`${booted.url}/media`);
    expect(page.status).not.toBe(401);
  });

  it('awaits an async host page rather than racing it', async () => {
    booted = await boot({
      secret: SECRET,
      session: () => null,
      unauthenticatedPage: async ({ response }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        (response as HostResponse).status(401).send('<html>async host page</html>');
      },
    });

    // Without the await, the SPA would be served the moment the hook yielded — invisible with a
    // synchronous hook.
    const page = await fetch(`${booted.url}/media`);
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('async host page');
  });

  it('cannot open the console: the data API stays 401', async () => {
    booted = await boot({
      secret: SECRET,
      session: () => null,
      unauthenticatedPage: ({ response }) => {
        (response as HostResponse).status(200).send('<html>my page</html>');
      },
    });

    // Even with the host answering 200 on its own page, the gate has not moved.
    expect((await fetch(`${booted.url}/api/media/console/disks`)).status).toBe(401);
  });
});
