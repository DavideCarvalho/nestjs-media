/**
 * Headless client for opening the console from YOUR app.
 *
 * The console SPA is served at a literal path and knows nothing about your app's auth, so a plain
 * browser navigation to it carries no identity. Mode A closes that gap: an XHR from inside your app
 * — which DOES carry your auth — posts to the console's session endpoint, the `session` hook
 * decides, and the library answers with its own signed cookie. The navigation that follows rides it.
 *
 * No UI here on purpose: you own the button, the page and the copy. This module owns the two things
 * a host would otherwise have to rediscover — where the session endpoint actually lives, and how to
 * call it without the failure mode below.
 */

/** The mount default; matches `DurableDashboardModule.forRoot()`'s own `basePath` default. */
const DEFAULT_BASE_PATH = '/media';
/** Matches `MediaDashboardModule`'s own `apiBasePath` default of `${basePath}/api`. */
const DEFAULT_API_BASE_PATH = '/media/api';

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Where `POST` mints the console session cookie.
 *
 * Note this derives from `apiBasePath`, NOT `basePath`: the auth controller is mounted with the
 * console's JSON API, which `MediaDashboardModule` mounts separately from the SPA. Deriving it here
 * rather than at the call site means a host cannot get that split wrong, and cannot be silently
 * broken by the route moving under a version bump — the break would only show up as a runtime 404.
 */
export function mediaConsoleSessionUrl(apiBasePath: string = DEFAULT_API_BASE_PATH): string {
  return `${normalizeBasePath(apiBasePath)}/session`;
}

/** Where the console SPA itself is served. */
export function mediaConsoleUrl(basePath: string = DEFAULT_BASE_PATH): string {
  return normalizeBasePath(basePath) || '/';
}

export interface OpenConsoleOptions {
  /** Where the console SPA is mounted. MUST match `MediaDashboardModule.forRoot({ basePath })`. */
  basePath?: string;
  /**
   * Where the console's JSON API — and with it the session endpoint — is mounted. MUST match
   * `MediaDashboardModule.forRoot({ apiBasePath })`. Defaults to `${basePath}/api`, the same
   * defaulting the module itself does, so a host that set neither can pass neither.
   */
  apiBasePath?: string;
  /**
   * Headers for the mint request — in practice your app's `Authorization` header. A function (sync
   * or async) is accepted so a token can be read at call time rather than captured at wiring time,
   * which is what a refreshing token needs.
   */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Injected for tests and non-browser callers. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  /**
   * Performs the navigation after a successful mint. Defaults to `location.assign`. Override to
   * route through your own router, or to open in a new tab.
   */
  navigate?: (url: string) => void;
}

/** Thrown when the session could not be minted. Never thrown after a successful mint. */
export class ConsoleSessionError extends Error {
  constructor(
    message: string,
    readonly url: string,
    /** The HTTP status, or `undefined` when the request never produced one (network error). */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ConsoleSessionError';
  }
}

/**
 * Mirror the module's own defaulting: an explicit `apiBasePath` wins, otherwise it hangs off
 * `basePath`, so a host that only customised the SPA mount still hits the right session endpoint.
 */
function resolveApiBasePath(options: OpenConsoleOptions): string {
  if (options.apiBasePath !== undefined) return options.apiBasePath;
  if (options.basePath !== undefined) return `${normalizeBasePath(options.basePath)}/api`;
  return DEFAULT_API_BASE_PATH;
}

async function resolveHeaders(headers: OpenConsoleOptions['headers']): Promise<HeadersInit> {
  if (headers === undefined) return {};
  return typeof headers === 'function' ? await headers() : headers;
}

/**
 * Mint the console session cookie. Resolves on success; throws {@link ConsoleSessionError} on
 * refusal. Use this directly when you want to mint without navigating (a pre-flight check, or a
 * link the user opens later).
 */
export async function mintMediaConsoleSession(options: OpenConsoleOptions = {}): Promise<void> {
  const url = mediaConsoleSessionUrl(resolveApiBasePath(options));
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new ConsoleSessionError('No `fetch` available; pass one via `options.fetch`.', url);
  }

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      // The whole point: the response's Set-Cookie must stick, and the cookie must ride the
      // navigation that follows.
      credentials: 'include',
      headers: await resolveHeaders(options.headers),
      // Load-bearing, and the reason this helper exists rather than three lines at the call site.
      // `fetch` FOLLOWS redirects by default, so an app whose auth layer rewrites a 401 into a
      // "go to /signin" redirect makes this request resolve 200 against the sign-in HTML —
      // `response.ok` reads true, the caller navigates, and the user lands in a console with no
      // session, which looks exactly like a permissions bug. Handling the redirect explicitly turns
      // that into a clear error instead of a silent false success.
      redirect: 'manual',
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    throw new ConsoleSessionError(
      `Could not reach the console session endpoint at ${url}: ${String(cause)}`,
      url,
    );
  }

  // `redirect: 'manual'` surfaces differently per runtime: browsers give an opaque response
  // (`type: 'opaqueredirect'`, status 0), Node/undici gives the real 3xx. Both mean the same thing.
  const redirected =
    response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
  if (redirected) {
    throw new ConsoleSessionError(
      `The console session endpoint at ${url} answered with a redirect instead of minting a session. Something in front of it — usually an auth middleware or exception filter that rewrites 401s into a sign-in redirect — is intercepting the response. Exempt this path from that rewrite so the real status reaches this caller.`,
      url,
      response.status || undefined,
    );
  }

  if (!response.ok) {
    throw new ConsoleSessionError(
      `The console refused to open (HTTP ${response.status}).`,
      url,
      response.status,
    );
  }
}

/**
 * Mint the session, then navigate to the console. Throws without navigating when the mint is
 * refused, so a denied user gets a real error instead of landing on the console's
 * "no session" page — which reads as a bug rather than a permission decision.
 */
export async function openMediaConsole(options: OpenConsoleOptions = {}): Promise<void> {
  await mintMediaConsoleSession(options);
  const target = mediaConsoleUrl(options.basePath);
  const navigate = options.navigate ?? ((url: string) => globalThis.location?.assign(url));
  navigate(target);
}
