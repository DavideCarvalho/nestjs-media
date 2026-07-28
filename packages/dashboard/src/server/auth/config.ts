import type { ConsoleSessionUser } from './session-cookie.js';

/** Host hook for Mode A — validates the host's own auth on the raw request. */
export type SessionHook = (
  request: unknown,
) => Promise<ConsoleSessionUser | null> | ConsoleSessionUser | null;

/** Host hook for Mode B — validates submitted credentials from the built-in login screen. */
export type LoginHook = (
  username: string,
  password: string,
) => Promise<ConsoleSessionUser | null> | ConsoleSessionUser | null;

/**
 * Re-checks a LIVE session when the cookie is slid forward. Runs at most once per `ttl/2` per
 * session, so a DB round-trip here is cheap. Return `false` to revoke (the cookie is cleared and
 * the request denied). Distinct from `session`: that hook reads the host's auth off a fresh
 * request, which a console XHR does not carry — this one receives the already-minted session.
 */
export type RevalidateHook = (session: ConsoleSessionUser) => Promise<boolean> | boolean;

/** What `unauthenticatedPage` receives. An object (not positional args) so fields can be added later. */
export interface UnauthenticatedPageContext {
  /**
   * The platform-native request — Express' `Request`, Fastify's `FastifyRequest`. Typed `unknown`
   * for the same reason `SessionHook`'s is: this package refuses to depend on either platform.
   */
  request: unknown;
  /**
   * The platform-native response. The hook OWNS it: it must write AND end it. If it returns without
   * writing, the console falls back to serving its own SPA (whose auth screen then renders).
   */
  response: unknown;
  /** Where this console is mounted (e.g. `/media`) — useful for a "back to the console" link. */
  basePath: string;
}

/**
 * Host-owned page for an unauthenticated navigation to the console SPA.
 *
 * Without it, an unauthenticated visitor gets the SPA shell, which then renders the built-in auth
 * screen: a generic "open this console from your application" card, generic because the library
 * cannot know who hosts it. This hook replaces that with the host's own page — and, because it is
 * decided BEFORE the shell is served, it also stops the bundle from loading for a visitor who has
 * no session at all.
 *
 * Only consulted under Mode-A-only. With `login` configured the SPA's own login form IS the way in,
 * so gating the shell would lock Mode B hosts out of their own console.
 *
 * Fail-closed by construction: it only ever runs when the request has no valid session. A hook that
 * throws, or returns without writing, falls back to serving the SPA — it cannot let anyone in,
 * because every data route stays behind `MediaConsoleGuard` regardless.
 */
export type UnauthenticatedPageHook = (context: UnauthenticatedPageContext) => void | Promise<void>;

/** Author-facing `auth` option on `MediaDashboardModule.forRoot`. Mirrors telescope's dashboardAuth. */
export interface ConsoleAuthOptions {
  /** REQUIRED HMAC-SHA256 signing key. Missing/empty => boot error (fail closed). */
  secret: string;
  /** Cookie TTL as a duration string (`'8h'`, `'30m'`, `'7d'`). Default `'8h'`. */
  ttl?: string;
  /** Mode A: validate the host's own auth on the raw request. */
  session?: SessionHook;
  /** Mode B: validate credentials from the built-in login screen. */
  login?: LoginHook;
  /** Re-checks the session on sliding renewal. Not a mode — it cannot mint a session on its own. */
  revalidate?: RevalidateHook;
  /** Renders the host's own page for an unauthenticated navigation, in place of serving the SPA and
   *  letting its built-in auth screen render; see `UnauthenticatedPageHook`. Mode-A-only. */
  unauthenticatedPage?: UnauthenticatedPageHook;
}

export type AuthMode = 'session' | 'login';

/** Resolved, validated console-auth config shared by the guard, controller, and SPA. */
export interface ResolvedConsoleAuth {
  secret: string;
  ttlMs: number;
  modes: AuthMode[];
  session?: SessionHook;
  login?: LoginHook;
  revalidate?: RevalidateHook;
  unauthenticatedPage?: UnauthenticatedPageHook;
}

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** Parse a `'<number><s|m|h|d>'` duration to ms; falls back to the 8h default on a bad value. */
function durationToMs(ttl: string | undefined): number {
  if (ttl === undefined) return DEFAULT_TTL_MS;
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return DEFAULT_TTL_MS;
  const unit = DURATION_UNITS[match[2] ?? ''];
  if (unit === undefined) return DEFAULT_TTL_MS;
  return Number(match[1]) * unit;
}

/**
 * Validate + resolve the `auth` option. Returns `null` when unconfigured (the console stays open —
 * front it with your own guard). Throws at boot (fail closed) when configured but missing a secret
 * or any hook — the host learns immediately rather than shipping an un-mintable gate.
 */
export function resolveConsoleAuth(
  options: ConsoleAuthOptions | undefined,
): ResolvedConsoleAuth | null {
  if (!options) return null;
  if (!options.secret) {
    throw new Error('MediaDashboardModule: auth.secret is required when `auth` is configured.');
  }
  const modes: AuthMode[] = [];
  if (options.session) modes.push('session');
  if (options.login) modes.push('login');
  if (modes.length === 0) {
    throw new Error('MediaDashboardModule: auth needs a `login` and/or `session` hook.');
  }
  if (
    options.unauthenticatedPage !== undefined &&
    typeof options.unauthenticatedPage !== 'function'
  ) {
    throw new Error('MediaDashboardModule: auth.unauthenticatedPage must be a function.');
  }
  return {
    secret: options.secret,
    ttlMs: durationToMs(options.ttl),
    modes,
    ...(options.session ? { session: options.session } : {}),
    ...(options.login ? { login: options.login } : {}),
    ...(options.revalidate ? { revalidate: options.revalidate } : {}),
    ...(options.unauthenticatedPage ? { unauthenticatedPage: options.unauthenticatedPage } : {}),
  };
}
