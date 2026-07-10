import { type DynamicModule, Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { type ConsoleAuthOptions, resolveConsoleAuth } from './auth/config.js';
import { MediaConsoleApiModule } from './media-console-api.module.js';
import { MediaDashboardUiController } from './media-dashboard-ui.controller.js';
import { MEDIA_DASHBOARD_API_PATH, MEDIA_DASHBOARD_BASE_PATH } from './tokens.js';

export interface MediaDashboardOptions {
  /**
   * Where the SPA (UI) is served. Default `/media`. A page route — keep it out of an `/api`
   * prefix so it reads as a UI, not an endpoint.
   */
  basePath?: string;
  /**
   * Where the JSON API is mounted (what the SPA fetches). Default `<basePath>/api`. Set it under
   * your app's `/api` prefix — e.g. `/api/media/console` — so the API inherits the app's
   * auth/proxy rules while the UI stays at `basePath`.
   */
  apiBasePath?: string;
  /**
   * Enable the destructive endpoints (delete object/record, copy/move, abort upload). Default
   * `false` — the read API is always available. Front the mount with your own guard either way.
   */
  actions?: boolean;
  /**
   * Gate the console (SPA + API) behind a built-in session-cookie login, telescope-style. Omit to
   * leave the console open (front it with your own guard). When set, the SPA renders a login screen
   * until a valid cookie exists; supply a `login(username, password)` and/or `session(request)`
   * hook that returns a session user (or `null` to deny) — see {@link ConsoleAuthOptions}.
   */
  auth?: ConsoleAuthOptions;
}

/** Leading slash, no trailing slash. */
function normalize(path: string): string {
  return `/${path.replace(/^\/+|\/+$/g, '')}`;
}

/**
 * Mounts the /media console: the bundled React SPA at `basePath` and its JSON API at `apiBasePath`
 * (default `<basePath>/api`). Import via `MediaDashboardModule.forRoot(...)` alongside
 * `MediaModule` (global), so it resolves the storage/store/upload tokens. No auth is built in —
 * front the routes with a guard, and exclude the UI/API paths from any global `/api` prefix.
 */
@Module({})
export class MediaDashboardModule {
  static forRoot(options: MediaDashboardOptions = {}): DynamicModule {
    const basePath = normalize(options.basePath ?? '/media');
    const apiBasePath = normalize(options.apiBasePath ?? `${basePath}/api`);
    const actions = options.actions === true;
    const auth = resolveConsoleAuth(options.auth);
    return {
      module: MediaDashboardModule,
      imports: [
        MediaConsoleApiModule.register({ actions, auth, cookiePath: apiBasePath }),
        RouterModule.register([
          { path: basePath, module: MediaDashboardModule }, // the UI controller below
          { path: apiBasePath, module: MediaConsoleApiModule },
        ]),
      ],
      controllers: [MediaDashboardUiController],
      providers: [
        { provide: MEDIA_DASHBOARD_BASE_PATH, useValue: basePath },
        { provide: MEDIA_DASHBOARD_API_PATH, useValue: apiBasePath },
      ],
      // Re-export the API module so its MediaConsoleService reaches importers if they want it.
      exports: [MediaConsoleApiModule],
    };
  }
}
