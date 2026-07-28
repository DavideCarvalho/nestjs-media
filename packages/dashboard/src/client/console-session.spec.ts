import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConsoleSessionError,
  mediaConsoleSessionUrl,
  mediaConsoleUrl,
  mintMediaConsoleSession,
  openMediaConsole,
} from './console-session.js';

function response(init: { status?: number; type?: string } = {}): Response {
  const status = init.status ?? 204;
  return {
    ok: status >= 200 && status < 300,
    status,
    type: init.type ?? 'basic',
  } as Response;
}

/**
 * The first `fetch` call's arguments, asserted present. Under `noUncheckedIndexedAccess` a bare
 * `mock.calls[0]` is possibly-undefined; failing loudly here also turns "the request was never
 * made" into a clear message instead of a destructuring TypeError.
 */
function firstCall(mock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('fetch was never called');
  return call as [string, RequestInit];
}

describe('mediaConsoleSessionUrl', () => {
  it('derives the mint path from the default mount', () => {
    expect(mediaConsoleSessionUrl()).toBe('/media/api/session');
    expect(mediaConsoleUrl()).toBe('/media');
  });

  it('derives the mint path from apiBasePath, not basePath', () => {
    // The session endpoint rides the JSON API mount, which this module mounts separately from the
    // SPA — the split a host would most plausibly get wrong by hand.
    expect(mediaConsoleSessionUrl('/api/media/console')).toBe('/api/media/console/session');
    expect(mediaConsoleUrl('/media')).toBe('/media');
  });

  it('tolerates a missing leading slash and a trailing one', () => {
    expect(mediaConsoleSessionUrl('ops/')).toBe('/ops/session');
    expect(mediaConsoleUrl('ops/')).toBe('/ops');
  });
});

describe('mintMediaConsoleSession', () => {
  it('posts with credentials so the Set-Cookie sticks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    await mintMediaConsoleSession({ fetch: fetchMock });

    const [url, init] = firstCall(fetchMock);
    expect(url).toBe('/media/api/session');
    expect(init.method).toBe('POST');
    // Without this the cookie is dropped and the navigation lands session-less.
    expect(init.credentials).toBe('include');
  });

  it('sends host headers, resolving a function at call time', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    // A function (not a captured value) is what a refreshing token needs.
    await mintMediaConsoleSession({
      fetch: fetchMock,
      headers: () => ({ Authorization: 'Bearer fresh-token' }),
    });

    expect(firstCall(fetchMock)[1].headers).toEqual({ Authorization: 'Bearer fresh-token' });
  });

  it('awaits an async headers function', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    await mintMediaConsoleSession({
      fetch: fetchMock,
      headers: async () => ({ Authorization: 'Bearer awaited' }),
    });

    expect(firstCall(fetchMock)[1].headers).toEqual({ Authorization: 'Bearer awaited' });
  });

  it('throws with the status when the console refuses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 401 }));

    await expect(mintMediaConsoleSession({ fetch: fetchMock })).rejects.toBeInstanceOf(
      ConsoleSessionError,
    );
    await expect(mintMediaConsoleSession({ fetch: fetchMock })).rejects.toMatchObject({
      status: 401,
      url: '/media/api/session',
    });
  });

  it('does not follow redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    await mintMediaConsoleSession({ fetch: fetchMock });

    // `fetch` follows redirects by default; that default is what turns an intercepted 401 into a
    // silent success against someone else's HTML.
    expect(firstCall(fetchMock)[1].redirect).toBe('manual');
  });

  it('reports a browser opaque redirect as an interception, not a success', async () => {
    // Browsers answer `redirect: 'manual'` with an opaque response: status 0, `ok: false`. Without
    // the explicit check the generic "HTTP 0" message would say nothing about the real cause.
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 0, type: 'opaqueredirect' }));

    await expect(mintMediaConsoleSession({ fetch: fetchMock })).rejects.toThrow(
      /answered with a redirect/,
    );
  });

  it('reports a Node/undici 3xx as the same interception', async () => {
    // Same failure, different runtime: undici surfaces the real status instead of an opaque type.
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 302 }));

    await expect(mintMediaConsoleSession({ fetch: fetchMock })).rejects.toThrow(
      /answered with a redirect/,
    );
  });

  it('wraps a network failure rather than leaking the raw rejection', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(mintMediaConsoleSession({ fetch: fetchMock })).rejects.toBeInstanceOf(
      ConsoleSessionError,
    );
  });
});

describe('openMediaConsole', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    navigate.mockClear();
  });

  it('navigates to the console after a successful mint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    await openMediaConsole({ fetch: fetchMock, navigate });

    expect(navigate).toHaveBeenCalledWith('/media');
  });

  it('navigates to the custom mount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    await openMediaConsole({ fetch: fetchMock, navigate, basePath: '/ops/files' });

    expect(navigate).toHaveBeenCalledWith('/ops/files');
  });

  it('derives apiBasePath from basePath when only basePath is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    await openMediaConsole({ fetch: fetchMock, navigate, basePath: '/ops/files' });

    // Mirrors the module's own `apiBasePath ?? `${basePath}/api`` defaulting, so a host that only
    // moved the SPA still hits the right session endpoint instead of a 404.
    expect(firstCall(fetchMock)[0]).toBe('/ops/files/api/session');
  });

  it('lets an explicit apiBasePath win over the derived one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    await openMediaConsole({
      fetch: fetchMock,
      navigate,
      basePath: '/media',
      apiBasePath: '/api/media/console',
    });

    // flip's real wiring: the SPA at /media, the API under the app's own /api prefix.
    expect(firstCall(fetchMock)[0]).toBe('/api/media/console/session');
    expect(navigate).toHaveBeenCalledWith('/media');
  });

  it('does NOT navigate when the mint is refused', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 403 }));

    await expect(openMediaConsole({ fetch: fetchMock, navigate })).rejects.toBeInstanceOf(
      ConsoleSessionError,
    );
    // Navigating anyway would drop the user on the console's "no session" page, which reads as a
    // broken console rather than a permission decision.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does NOT navigate when the response was an intercepted redirect', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 0, type: 'opaqueredirect' }));

    await expect(openMediaConsole({ fetch: fetchMock, navigate })).rejects.toThrow(
      /answered with a redirect/,
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
