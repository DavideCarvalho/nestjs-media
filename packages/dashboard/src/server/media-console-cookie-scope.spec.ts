import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
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
const DENIED_BODY = 'host-locked-page';
const BASE_PATH = '/media';
const API_BASE_PATH = '/api/media/console';

/** Express `Response` surface the hook uses; the spec never imports Express itself. */
interface HostResponse {
  status(code: number): HostResponse;
  type(value: string): HostResponse;
  send(body: string): unknown;
}

async function boot() {
  @Module({
    imports: [
      MockMediaModule,
      MediaDashboardModule.forRoot({
        basePath: BASE_PATH,
        // Deliberately OUTSIDE `basePath` — the configuration a host lands on when it mounts the
        // console API under its own global `/api` prefix. This is the shape the bug needed.
        apiBasePath: API_BASE_PATH,
        auth: {
          secret: SECRET,
          // Mode A: the host authenticates the MINT request (here, a header standing in for
          // flip's Bearer token); every request after it is carried by the cookie alone. The
          // hook has to READ the request — one that returns a user unconditionally would
          // authenticate the anonymous navigation too, and the round trip below would prove
          // nothing.
          session: (request) =>
            (request as { headers?: Record<string, unknown> })?.headers?.['x-admin'] === 'yes'
              ? { id: 'ops', roles: ['admin'] }
              : null,
          // Present so a denied navigation is DISTINGUISHABLE. Without it the shell falls back to
          // serving the SPA and letting its built-in auth screen render, which in a unit run (no
          // bundle built) 404s — the same 404 an allowed navigation gets, leaving the round trip
          // below unable to tell "denied" from "allowed". This also mirrors how hosts that use
          // Mode A actually configure the console.
          unauthenticatedPage: ({ response }) => {
            (response as HostResponse).status(401).type('text/plain').send(DENIED_BODY);
          },
        },
      }),
    ],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  return { app, url: await app.getUrl() };
}

/** The `Path` attribute of a `Set-Cookie`, defaulting to `/` when absent. */
function cookiePath(setCookie: string): string {
  const match = /;\s*path=([^;]*)/i.exec(setCookie);
  return match?.[1]?.trim() || '/';
}

/**
 * RFC 6265 §5.1.4 path-match: would a browser attach a cookie scoped to `path` to a request for
 * `requestPath`? Reimplemented here because the specs use `fetch`, which — like supertest — does
 * not enforce cookie scope, which is exactly why this bug survived every existing test.
 */
function browserWouldSend(path: string, requestPath: string): boolean {
  if (path === requestPath) return true;
  if (!requestPath.startsWith(path)) return false;
  return path.endsWith('/') || requestPath[path.length] === '/';
}

/**
 * The session cookie has to reach BOTH mounts: the SPA shell at `basePath` (a full-page navigation
 * carries cookies and nothing else) and the JSON API at `apiBasePath`. When they are configured at
 * unrelated paths, only `Path=/` satisfies both.
 *
 * This is a regression test for a real breakage: the cookie was scoped to `apiBasePath`, so the
 * browser withheld it on the navigation to `/media` and the freshly minted session could not open
 * the console it had just been minted for — the launcher landed on the unauthenticated page, which
 * reads exactly like "you lack access". Every existing test replayed the cookie by hand with
 * `setCookie.split(';')[0]`, discarding the very attribute that was wrong.
 */
describe('console session cookie scope', () => {
  let booted: { app: { close(): Promise<unknown> }; url: string } | undefined;

  afterEach(async () => {
    await booted?.app.close();
    booted = undefined;
  });

  it('is scoped so the browser sends it to BOTH the shell and the API', async () => {
    booted = await boot();

    const mint = await fetch(`${booted.url}${API_BASE_PATH}/session`, {
      method: 'POST',
      headers: { 'x-admin': 'yes' },
    });
    expect(mint.status).toBeLessThan(400);

    const setCookie = mint.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const path = cookiePath(setCookie ?? '');

    // The navigation the launcher performs right after minting. This is the assertion that was
    // missing: scoped to `/api/media/console`, it is false.
    expect(
      browserWouldSend(path, BASE_PATH),
      `cookie Path=${path} never reaches ${BASE_PATH}`,
    ).toBe(true);
    expect(
      browserWouldSend(path, `${API_BASE_PATH}/disks`),
      `cookie Path=${path} never reaches ${API_BASE_PATH}`,
    ).toBe(true);
  });

  it('opens the shell it was just minted for', async () => {
    booted = await boot();

    const mint = await fetch(`${booted.url}${API_BASE_PATH}/session`, {
      method: 'POST',
      headers: { 'x-admin': 'yes' },
    });
    const cookie = (mint.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie).toBeTruthy();

    // End of the round trip: the cookie alone must get PAST the gate. Asserted as "did not get
    // the locked page" rather than "200" on purpose — no SPA bundle is built in a unit run, so
    // an allowed navigation 404s on the missing asset, and pinning 200 would only test the build.
    //
    // Kept alongside the scope assertion above rather than replacing it: this one passes even
    // with a wrongly scoped cookie, because `fetch` sends whatever header it is handed.
    const shell = await fetch(`${booted.url}${BASE_PATH}`, { headers: { cookie } });
    expect(await shell.text()).not.toContain(DENIED_BODY);

    // The failure the user actually saw: mint succeeds, navigation lands on the locked page.
    const anonymous = await fetch(`${booted.url}${BASE_PATH}`);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).toContain(DENIED_BODY);
  });
});
