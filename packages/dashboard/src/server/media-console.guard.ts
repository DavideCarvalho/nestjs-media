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
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  issueSessionCookie,
} from './auth/session-cookie-io.js';
import {
  type ConsoleSession,
  type ConsoleSessionUser,
  verifySessionCookie,
} from './auth/session-cookie.js';
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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.auth) return true;
    const http = context.switchToHttp();
    const request = http.getRequest();
    const session = this.verifyRequestSession(request);
    // Absent/invalid/expired cookie => 401 (not 403): the SPA reads this as "show the login screen".
    if (!session) throw new UnauthorizedException();
    attachSession(request, session);
    if (!(await this.maybeRenew(http.getResponse(), request, session))) {
      // Revoked mid-session: same 401 as an absent cookie.
      throw new UnauthorizedException();
    }
    return true;
  }

  private verifyRequestSession(request: unknown): ConsoleSession | null {
    if (!this.auth) return null;
    const cookieValue = parseCookieHeader(readCookieHeader(request))[SESSION_COOKIE_NAME];
    if (cookieValue === undefined) return null;
    return verifySessionCookie(cookieValue, { secret: this.auth.secret });
  }

  /**
   * Sliding renewal + revalidation: when a valid cookie is past half its TTL, re-issue a fresh one
   * so active users never get logged out mid-session — but first let the host's `revalidate` hook
   * re-check the user, so a deactivated or demoted operator loses access instead of riding a
   * self-renewing cookie. Returns `false` when the session was revoked (cookie already cleared).
   */
  private async maybeRenew(
    response: unknown,
    request: unknown,
    session: ConsoleSession,
  ): Promise<boolean> {
    if (!this.auth) return true;
    const now = Date.now();
    if (now - session.iat <= this.auth.ttlMs / 2) return true;
    const user: ConsoleSessionUser = {
      id: session.sub,
      ...(session.name !== undefined ? { name: session.name } : {}),
      roles: session.roles,
    };
    if (this.auth.revalidate) {
      let allowed: boolean;
      try {
        allowed = await this.auth.revalidate(user);
      } catch {
        allowed = false; // Fail closed.
      }
      if (!allowed) {
        clearSessionCookie({ cookiePath: this.cookiePath ?? '/', request, response });
        return false;
      }
    }
    issueSessionCookie(user, {
      auth: this.auth,
      cookiePath: this.cookiePath ?? '/',
      request,
      response,
      now,
    });
    return true;
  }
}
