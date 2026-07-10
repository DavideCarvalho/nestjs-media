import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConsoleAuthOptions, ResolvedConsoleAuth } from './auth/config.js';
import { parseCookieHeader } from './auth/cookie-header.js';
import { readCookieHeader } from './auth/request.js';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  issueSessionCookie,
} from './auth/session-cookie-io.js';
import { type ConsoleSessionUser, verifySessionCookie } from './auth/session-cookie.js';
import { MEDIA_CONSOLE_AUTH, MEDIA_CONSOLE_COOKIE_PATH } from './tokens.js';

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

/** Response of `GET /me`: the console SPA renders the login screen or the console from this. */
type MeResponse =
  | { authRequired: false }
  | { user: { id: string; name?: string; roles: string[] } };

/**
 * Mints/clears the console session cookie. Deliberately NOT decorated with `MediaConsoleGuard` —
 * these endpoints CREATE the session the gate checks for. When the host didn't configure `auth`,
 * `GET /me` reports `authRequired: false` (the SPA shows the console) and login/logout 404.
 */
@Controller()
export class MediaConsoleAuthController {
  private readonly logger = new Logger(MediaConsoleAuthController.name);
  /** One warn per hook kind, so a flaky hook doesn't spam logs every request. */
  private readonly warnedHooks = new Set<string>();

  constructor(
    @Optional() @Inject(MEDIA_CONSOLE_AUTH) private readonly auth: ResolvedConsoleAuth | null,
    @Optional() @Inject(MEDIA_CONSOLE_COOKIE_PATH) private readonly cookiePath: string | null,
  ) {}

  @Get('me')
  me(@Req() request: unknown): MeResponse {
    if (!this.auth) return { authRequired: false };
    const cookieValue = parseCookieHeader(readCookieHeader(request))[SESSION_COOKIE_NAME];
    const session =
      cookieValue !== undefined
        ? verifySessionCookie(cookieValue, { secret: this.auth.secret })
        : null;
    // The UNauthenticated SPA learns which login mode(s) to offer from this 401 body.
    if (!session) throw new UnauthorizedException({ auth: { modes: this.auth.modes } });
    return {
      user: {
        id: session.sub,
        ...(session.name !== undefined ? { name: session.name } : {}),
        roles: session.roles,
      },
    };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginBody,
    @Req() request: unknown,
    @Res({ passthrough: true }) response: unknown,
  ): Promise<MeResponse> {
    const auth = this.requireAuth();
    if (!auth.login) throw new NotFoundException();
    if (typeof body?.username !== 'string' || typeof body?.password !== 'string') {
      throw new BadRequestException('Body must include string `username` and `password`.');
    }
    const username = body.username;
    const password = body.password;
    // Uniform 401 for unknown user / bad password — no user-enumeration.
    const user = await this.runHook('login', () => auth.login?.(username, password) ?? null);
    if (!user) throw new UnauthorizedException({ message: 'Invalid credentials' });
    return this.mint(user, request, response);
  }

  @Post('session')
  @HttpCode(200)
  async session(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: unknown,
  ): Promise<MeResponse> {
    const auth = this.requireAuth();
    if (!auth.session) throw new NotFoundException();
    const user = await this.runHook('session', () => auth.session?.(request) ?? null);
    if (!user) throw new UnauthorizedException();
    return this.mint(user, request, response);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Req() request: unknown, @Res({ passthrough: true }) response: unknown): void {
    // Best-effort: even without auth configured, clearing is harmless.
    clearSessionCookie({ cookiePath: this.cookiePath ?? '/', request, response });
  }

  private requireAuth(): ResolvedConsoleAuth {
    if (!this.auth) throw new NotFoundException();
    return this.auth;
  }

  private mint(user: ConsoleSessionUser, request: unknown, response: unknown): MeResponse {
    const auth = this.requireAuth();
    issueSessionCookie(user, {
      auth,
      cookiePath: this.cookiePath ?? '/',
      request,
      response,
    });
    return {
      user: {
        id: user.id,
        ...(user.name !== undefined ? { name: user.name } : {}),
        roles: user.roles ?? [],
      },
    };
  }

  /** Run a host hook defensively: a throw is a denial (null), warn-logged once per kind. */
  private async runHook(
    kind: string,
    run: () => Promise<ConsoleSessionUser | null> | ConsoleSessionUser | null,
  ): Promise<ConsoleSessionUser | null> {
    try {
      return (await run()) ?? null;
    } catch (error) {
      if (!this.warnedHooks.has(kind)) {
        this.warnedHooks.add(kind);
        this.logger.warn(`Console auth ${kind} hook threw; treating as denial. ${String(error)}`);
      }
      return null;
    }
  }
}

export type { ConsoleAuthOptions };
