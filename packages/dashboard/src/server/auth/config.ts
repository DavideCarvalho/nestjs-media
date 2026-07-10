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
}

export type AuthMode = 'session' | 'login';

/** Resolved, validated console-auth config shared by the guard, controller, and SPA. */
export interface ResolvedConsoleAuth {
  secret: string;
  ttlMs: number;
  modes: AuthMode[];
  session?: SessionHook;
  login?: LoginHook;
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
  return {
    secret: options.secret,
    ttlMs: durationToMs(options.ttl),
    modes,
    ...(options.session ? { session: options.session } : {}),
    ...(options.login ? { login: options.login } : {}),
  };
}
