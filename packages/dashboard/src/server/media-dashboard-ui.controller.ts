import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { ResolvedConsoleAuth } from './auth/config.js';
import { parseCookieHeader } from './auth/cookie-header.js';
import { readCookieHeader } from './auth/request.js';
import { responseAlreadyWritten, sendHtml } from './auth/response.js';
import { SESSION_COOKIE_NAME } from './auth/session-cookie-io.js';
import { verifySessionCookie } from './auth/session-cookie.js';
import {
  MEDIA_CONSOLE_AUTH,
  MEDIA_DASHBOARD_API_PATH,
  MEDIA_DASHBOARD_BASE_PATH,
} from './tokens.js';

/** The base the SPA bundle was built with (Vite `base`); rewritten to the configured base at serve time. */
const BUILD_BASE = '/media';

/** dist/server/index.js -> ../spa (the Vite build output). */
function spaDir(): string {
  return fileURLToPath(new URL('../spa', import.meta.url));
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/**
 * Serves the bundled /media console SPA at the configured base (+ hashed assets at `<base>/assets`).
 * The path comes from `RouterModule` (set by `MediaDashboardModule.forRoot({ basePath })`), so the
 * controller routes are relative.
 */
@Controller()
export class MediaDashboardUiController {
  private readonly dir = spaDir();
  private readonly logger = new Logger(MediaDashboardUiController.name);
  private warned = false;

  constructor(
    @Inject(MEDIA_DASHBOARD_BASE_PATH) private readonly basePath: string,
    @Inject(MEDIA_DASHBOARD_API_PATH) private readonly apiBasePath: string,
    @Optional()
    @Inject(MEDIA_CONSOLE_AUTH)
    private readonly auth: ResolvedConsoleAuth | null = null,
  ) {}

  // index.html references hash-named bundles, so it MUST NOT be cached (stale bundle = "stuck
  // loading after a deploy"). The hashed assets below are immutable. `sendHtml` sets both headers;
  // they are no longer `@Header` decorators because this route is now non-passthrough (see below).
  //
  // Non-passthrough `@Res()` so a host's `auth.unauthenticatedPage` can OWN the response and serve
  // its own page in place of the SPA. Without a hook this behaves exactly as before: the shell is
  // served to everyone, and the SPA's own auth screen renders once its API calls come back 401.
  @Get()
  async index(@Req() req: unknown, @Res() res: unknown): Promise<void> {
    if (await this.serveUnauthenticatedPage(req, res)) return;

    const indexPath = join(this.dir, 'index.html');
    if (!existsSync(indexPath)) {
      throw new NotFoundException('Console SPA is not built. Run the package build.');
    }
    // Built with Vite base `/media/`; rewrite asset URLs to the configured base so the SPA loads
    // from `<base>/assets` wherever it's mounted, and tell the client its API base.
    const html = readFileSync(indexPath, 'utf8').replaceAll(
      `="${BUILD_BASE}/`,
      `="${this.basePath}/`,
    );
    const inject = `<script>window.__MEDIA_BASE__='${this.basePath}';window.__MEDIA_API__='${this.apiBasePath}';</script>`;
    sendHtml(
      res,
      200,
      html.includes('</head>') ? html.replace('</head>', `${inject}</head>`) : inject + html,
    );
  }

  /**
   * Hand the response to the host's `unauthenticatedPage` when this navigation has no valid session.
   * Returns `true` when the host wrote a page (the caller must not also serve the SPA).
   *
   * Mode-A-only, deliberately: with `login` configured the SPA's own login form is the way in, so
   * replacing the shell would lock a Mode B host out of its own console.
   */
  private async serveUnauthenticatedPage(req: unknown, res: unknown): Promise<boolean> {
    const auth = this.auth;
    const hook = auth?.unauthenticatedPage;
    if (!auth || !hook) return false;
    if (auth.modes.includes('login')) return false;
    if (this.hasValidSession(auth, req)) return false;

    try {
      await hook({ request: req, response: res, basePath: this.basePath });
      if (responseAlreadyWritten(res)) return true;
      // Returned without writing. Serving the SPA is the only outcome that neither hangs the
      // request nor invents a page the host did not ask for — but it is almost certainly a bug.
      this.warnOnce(
        'auth.unauthenticatedPage returned without writing a response; serving the console SPA ' +
          'instead. The hook must write AND end the response it is given.',
      );
    } catch (error) {
      this.warnOnce(
        `auth.unauthenticatedPage threw; serving the console SPA instead. ${String(error)}`,
      );
      // It may have written headers before throwing; writing again would raise
      // ERR_HTTP_HEADERS_SENT on top of the original failure.
      if (responseAlreadyWritten(res)) return true;
    }
    // Falling back to the SPA is safe: every data route stays behind MediaConsoleGuard, so the
    // visitor gets the built-in auth screen, not the console's contents.
    return false;
  }

  private hasValidSession(auth: ResolvedConsoleAuth, req: unknown): boolean {
    const cookieValue = parseCookieHeader(readCookieHeader(req))[SESSION_COOKIE_NAME];
    if (cookieValue === undefined) return false;
    return verifySessionCookie(cookieValue, { secret: auth.secret }) !== null;
  }

  /** Once per process, not once per request: a broken hook fires on every unauthenticated visit. */
  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(message);
  }

  @Get('assets/:file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  asset(@Param('file') file: string): StreamableFile {
    const safe = basename(file);
    if (safe !== file) throw new NotFoundException();
    const root = resolve(this.dir, 'assets');
    const assetPath = resolve(root, safe);
    if (!assetPath.startsWith(root + sep) || !existsSync(assetPath)) {
      throw new NotFoundException();
    }
    const type = CONTENT_TYPES[extname(safe)] ?? 'application/octet-stream';
    return new StreamableFile(readFileSync(assetPath), { type });
  }
}
