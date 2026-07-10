import {
  type DynamicModule,
  Module,
  type ModuleMetadata,
  type OptionalFactoryDependency,
  type Provider,
} from '@nestjs/common';
import type { InjectionToken } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { type ConsoleAuthOptions, resolveConsoleAuth } from './auth/config.js';
import { MediaConsoleApiModule } from './media-console-api.module.js';
import { MediaDashboardUiController } from './media-dashboard-ui.controller.js';
import {
  MEDIA_CONSOLE_AUTH,
  MEDIA_DASHBOARD_API_PATH,
  MEDIA_DASHBOARD_BASE_PATH,
} from './tokens.js';

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

/**
 * Async variant of {@link MediaDashboardOptions}. The mount paths + `actions` stay static (the
 * router needs them at module-definition time), but `auth` is built by an injected factory — so
 * the `login`/`session` hooks can reach your DB/services (e.g. an EntityManager to validate an
 * admin). Returning `undefined` from the factory leaves the console open.
 */
export interface MediaDashboardAsyncOptions {
  basePath?: string;
  apiBasePath?: string;
  actions?: boolean;
  /** Modules exporting the providers `inject` needs (omit when they're global). */
  imports?: ModuleMetadata['imports'];
  /** Providers injected into `useAuth`, in order. */
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  /** Build the `auth` config from injected deps (or `undefined` to leave the console open). */
  useAuth: (
    ...deps: any[]
  ) => ConsoleAuthOptions | undefined | Promise<ConsoleAuthOptions | undefined>;
}

/** Leading slash, no trailing slash. */
function normalize(path: string): string {
  return `/${path.replace(/^\/+|\/+$/g, '')}`;
}

/**
 * Mounts the /media console: the bundled React SPA at `basePath` and its JSON API at `apiBasePath`
 * (default `<basePath>/api`). Import via `MediaDashboardModule.forRoot(...)` (or `forRootAsync` when
 * the `auth` hooks need injected services) alongside `MediaModule` (global), so it resolves the
 * storage/store/upload tokens. Exclude the UI/API paths from any global `/api` prefix.
 */
@Module({})
export class MediaDashboardModule {
  static forRoot(options: MediaDashboardOptions = {}): DynamicModule {
    const apiBasePath = normalize(
      options.apiBasePath ?? `${normalize(options.basePath ?? '/media')}/api`,
    );
    return MediaDashboardModule.build(options, apiBasePath, {
      provide: MEDIA_CONSOLE_AUTH,
      useValue: resolveConsoleAuth(options.auth),
    });
  }

  static forRootAsync(options: MediaDashboardAsyncOptions): DynamicModule {
    const apiBasePath = normalize(
      options.apiBasePath ?? `${normalize(options.basePath ?? '/media')}/api`,
    );
    const authProvider: Provider = {
      provide: MEDIA_CONSOLE_AUTH,
      inject: options.inject ?? [],
      useFactory: async (...deps: any[]) => resolveConsoleAuth(await options.useAuth(...deps)),
    };
    return MediaDashboardModule.build(options, apiBasePath, authProvider, options.imports);
  }

  /** Shared wiring: static routing + the API module, with `auth` supplied by the given provider. */
  private static build(
    options: { basePath?: string; apiBasePath?: string; actions?: boolean },
    apiBasePath: string,
    authProvider: Provider,
    imports?: ModuleMetadata['imports'],
  ): DynamicModule {
    const basePath = normalize(options.basePath ?? '/media');
    const actions = options.actions === true;
    return {
      module: MediaDashboardModule,
      imports: [
        MediaConsoleApiModule.register({ actions, cookiePath: apiBasePath, authProvider, imports }),
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
