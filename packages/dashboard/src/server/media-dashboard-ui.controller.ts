import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { ConsolePage } from './console-authorize.js';
import {
  type ConsoleSignOutOption,
  type ConsoleViewerResolver,
  resolveConsoleSignOut,
  resolveConsoleViewer,
} from './console-shell.js';
import { MEDIA_CONSOLE_ID, consoleSwitcherConfig, readAviaryConsoles } from './console-switcher.js';
import { OpenToAuthorization } from './controller-decorators.js';
import {
  MEDIA_DASHBOARD_API_PATH,
  MEDIA_DASHBOARD_BASE_PATH,
  MEDIA_DASHBOARD_SHELL,
} from './tokens.js';

/** The console shell options a {@link MediaDashboardUiController} reads (`viewer`, `signOut`). */
export interface MediaShellOptions {
  viewer?: ConsoleViewerResolver | undefined;
  signOut?: ConsoleSignOutOption | undefined;
}

/** The base the SPA bundle was built with (Vite `base`); rewritten to the configured base at serve time. */
const BUILD_BASE = '/media';

/** The id of the page's JSON config block. */
export const MEDIA_DASHBOARD_CONFIG_ID = 'media-dashboard-config';

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
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

/**
 * Serves the bundled /media console SPA at the configured base (+ hashed assets at `<base>/assets`).
 * The path comes from `RouterModule` (set by `MediaDashboardModule.forRoot({ basePath })`), so the
 * controller routes are relative.
 */
// Open to `@nestjs/authorization`'s deny-by-default guard; the console's `authorize` decides access.
// Marked as the page controller: a denied browser navigation here gets a redirect or a page, not JSON.
@OpenToAuthorization()
@ConsolePage()
@Controller()
export class MediaDashboardUiController {
  private readonly dir = spaDir();

  constructor(
    @Inject(MEDIA_DASHBOARD_BASE_PATH) private readonly basePath: string,
    @Inject(MEDIA_DASHBOARD_API_PATH) private readonly apiBasePath: string,
    @Optional() @Inject(MEDIA_DASHBOARD_SHELL) private readonly shell: MediaShellOptions = {},
  ) {}

  // index.html references hash-named bundles, so it MUST NOT be cached (stale bundle = "stuck
  // loading after a deploy"). The hashed assets below are immutable.
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, must-revalidate')
  async index(@Req() req: unknown): Promise<string> {
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
    const inject = `<script>window.__MEDIA_BASE__='${this.basePath}';window.__MEDIA_API__='${this.apiBasePath}';</script>${await this.configBlock(req)}`;
    return html.includes('</head>') ? html.replace('</head>', `${inject}</head>`) : inject + html;
  }

  /**
   * The page's JSON config block (`media-dashboard-config`, CSP-safe: data, not script). It carries
   * `switcher` only when another Aviary console is registered; `search` (⌘K, answering per console
   * too) whenever this console is in the registry; `viewer` and `signOut` for the sidebar footer
   * when they resolve (see `MediaDashboardOptions.viewer` / `signOut`).
   */
  private async configBlock(request: unknown): Promise<string> {
    const switcher = consoleSwitcherConfig(MEDIA_CONSOLE_ID, `${this.apiBasePath}/consoles`);
    const registry = readAviaryConsoles();
    const registered = registry?.entries.some((entry) => entry.id === MEDIA_CONSOLE_ID);
    const viewer = await resolveConsoleViewer(request, this.shell?.viewer);
    const signOut = resolveConsoleSignOut(request, this.shell?.signOut, registry);
    const json = JSON.stringify({
      apiBase: this.apiBasePath,
      ...(switcher !== undefined ? { switcher } : {}),
      ...(registered
        ? { search: { endpoint: `${this.apiBasePath}/consoles/search`, self: MEDIA_CONSOLE_ID } }
        : {}),
      ...(viewer ? { viewer } : {}),
      ...(signOut ? { signOut } : {}),
    }).replaceAll('<', '\\u003c');
    return `<script type="application/json" id="${MEDIA_DASHBOARD_CONFIG_ID}">${json}</script>`;
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
