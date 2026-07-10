import { serializeSetCookie } from './cookie-header.js';
import { isHttpsRequest } from './request.js';
import { appendSetCookie } from './response.js';
import { type ConsoleSessionUser, signSessionCookie } from './session-cookie.js';

/** Cookie name carrying the signed console session. */
export const SESSION_COOKIE_NAME = 'media_console_session';

interface CookieContext {
  auth: { secret: string; ttlMs: number };
  /** Cookie `Path` — the JSON API base, so the cookie rides every console API request. */
  cookiePath: string;
  request: unknown;
  response: unknown;
  now?: number;
}

/**
 * Sign a fresh session for `user` and append it as a `Set-Cookie` on the response, scoped to the
 * console API path and `Secure` when the request is https.
 */
export function issueSessionCookie(user: ConsoleSessionUser, context: CookieContext): void {
  const value = signSessionCookie(user, {
    secret: context.auth.secret,
    ttlMs: context.auth.ttlMs,
    ...(context.now !== undefined ? { now: context.now } : {}),
  });
  appendSetCookie(
    context.response,
    serializeSetCookie(SESSION_COOKIE_NAME, value, {
      path: context.cookiePath,
      maxAgeSeconds: Math.floor(context.auth.ttlMs / 1000),
      secure: isHttpsRequest(context.request),
    }),
  );
}

/** Append a cookie-clearing `Set-Cookie` (Max-Age=0) scoped to the console API path. */
export function clearSessionCookie(context: Omit<CookieContext, 'auth' | 'now'>): void {
  appendSetCookie(
    context.response,
    serializeSetCookie(SESSION_COOKIE_NAME, '', {
      path: context.cookiePath,
      maxAgeSeconds: 0,
      secure: isHttpsRequest(context.request),
      clear: true,
    }),
  );
}
