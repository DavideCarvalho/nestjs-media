import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { ResolvedConsoleAuth } from './auth/config.js';
import { parseCookieHeader } from './auth/cookie-header.js';
import { attachSession, readCookieHeader } from './auth/request.js';
import { SESSION_COOKIE_NAME, issueSessionCookie } from './auth/session-cookie-io.js';
import { type ConsoleSession, verifySessionCookie } from './auth/session-cookie.js';
import { MEDIA_CONSOLE_AUTH, MEDIA_CONSOLE_COOKIE_PATH } from './tokens.js';

/**
 * Gates the console's read + action controllers on a valid session cookie — but ONLY when the host
 * configured `auth`. With no auth configured the resolved value is `null` and the guard is a
 * no-op (the console stays open; front it with your own guard). The auth controller that MINTS the
 * cookie is deliberately NOT decorated with this guard.
 */
@Injectable()
export class MediaConsoleGuard implements CanActivate {
  constructor(
    @Optional() @Inject(MEDIA_CONSOLE_AUTH) private readonly auth: ResolvedConsoleAuth | null,
    @Optional() @Inject(MEDIA_CONSOLE_COOKIE_PATH) private readonly cookiePath: string | null,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.auth) return true;
    const http = context.switchToHttp();
    const request = http.getRequest();
    const session = this.verifyRequestSession(request);
    // Absent/invalid/expired cookie => 401 (not 403): the SPA reads this as "show the login screen".
    if (!session) throw new UnauthorizedException();
    attachSession(request, session);
    this.maybeRenew(http.getResponse(), request, session);
    return true;
  }

  private verifyRequestSession(request: unknown): ConsoleSession | null {
    if (!this.auth) return null;
    const cookieValue = parseCookieHeader(readCookieHeader(request))[SESSION_COOKIE_NAME];
    if (cookieValue === undefined) return null;
    return verifySessionCookie(cookieValue, { secret: this.auth.secret });
  }

  /**
   * Sliding renewal: when a valid cookie is past half its TTL, re-issue a fresh one so active users
   * never get logged out mid-session. Appends a new Set-Cookie (preserving any others already set).
   */
  private maybeRenew(response: unknown, request: unknown, session: ConsoleSession): void {
    if (!this.auth) return;
    const now = Date.now();
    if (now - session.iat <= this.auth.ttlMs / 2) return;
    issueSessionCookie(
      {
        id: session.sub,
        ...(session.name !== undefined ? { name: session.name } : {}),
        roles: session.roles,
      },
      {
        auth: this.auth,
        cookiePath: this.cookiePath ?? '/',
        request,
        response,
        now,
      },
    );
  }
}
