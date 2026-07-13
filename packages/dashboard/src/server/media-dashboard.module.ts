import {
  type CanActivate,
  type DynamicModule,
  Module,
  type ModuleMetadata,
  type OptionalFactoryDependency,
  type Provider,
  type Type,
} from '@nestjs/common';
import type { InjectionToken } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { type ConsoleAuthOptions, resolveConsoleAuth } from './auth/config.js';
import { isGuardClass, stampGuards } from './guards.js';
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
  /**
   * Guard classes (or already-instantiated `CanActivate`s) fronting BOTH the page/asset controller
   * (`MediaDashboardUiController` — a plain REPLACE, since it ships with no guard of its own) and
   * the read/action JSON API controllers (APPENDED to their own built-in `MediaConsoleGuard`
   * session-cookie gate — a request must pass BOTH). Deliberately NOT applied to the auth
   * controller that MINTS that session cookie — see `MediaConsoleApiModule`'s own `guards` doc.
   *
   * These two surfaces (page vs. API) live in the same package here, unlike a split dashboard —
   * but they're still SEPARATE controllers on separate host modules, so `guards` is stamped onto
   * each independently by this one option.
   *
   * Full-page navigations to `basePath` carry only cookies, never an `Authorization` header — a
   * guard passed here must be able to authenticate from a cookie (see the "Securing the console"
   * guide) or it will 401 every browser visit to the console, even an already-logged-in admin's.
   *
   * `guards` and `auth` (the built-in cookie login) are independent and compose: with both set, a
   * request must pass the host guard AND (when a route carries `MediaConsoleGuard`) present a valid
   * built-in session cookie too. Configure one, the other, or both.
   *
   * A guard's own DEPENDENCIES resolve from this option's `imports` (see {@link imports}) — the
   * dashboard module has no application context of its own to pull them from otherwise.
   */
  guards?: Array<Type<CanActivate> | CanActivate>;
  /**
   * Extra `imports` merged into the dashboard's dynamic module — the DI resolution path for a class
   * passed to {@link guards} (or any other provider the controllers need reachable). Typically the
   * host's own auth module, e.g. `imports: [AuthModule]` alongside `guards: [SessionGuard]`.
   */
  imports?: DynamicModule['imports'];
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
  /** Modules exporting the providers `inject` needs, or a guard class's own dependencies (omit
   *  when they're global). Shared with {@link guards}. */
  imports?: DynamicModule['imports'];
  /** Providers injected into `useAuth`, in order. */
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  /** Build the `auth` config from injected deps (or `undefined` to leave the console open). */
  useAuth: (
    ...deps: any[]
  ) => ConsoleAuthOptions | undefined | Promise<ConsoleAuthOptions | undefined>;
  /**
   * Guard classes (or instances) fronting the console — see {@link MediaDashboardOptions.guards}.
   * Passed here directly (not resolved via `useAuth`'s factory) because guard stamping happens at
   * module-build time, synchronously — the SAME constraint as `basePath`/`apiBasePath` above. A
   * class guard's own dependencies resolve from `imports` above (shared with `useAuth`'s `inject`).
   */
  guards?: Array<Type<CanActivate> | CanActivate>;
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
 *
 * Front it with your own auth via `guards` (+ `imports` for their dependencies) — see
 * {@link MediaDashboardOptions.guards} — instead of, or alongside, the built-in `auth` cookie login.
 */
@Module({})
export class MediaDashboardModule {
  static forRoot(options: MediaDashboardOptions = {}): DynamicModule {
    const apiBasePath = normalize(
      options.apiBasePath ?? `${normalize(options.basePath ?? '/media')}/api`,
    );
    return MediaDashboardModule.build(
      options,
      apiBasePath,
      { provide: MEDIA_CONSOLE_AUTH, useValue: resolveConsoleAuth(options.auth) },
      options.imports,
    );
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
    options: {
      basePath?: string;
      apiBasePath?: string;
      actions?: boolean;
      guards?: Array<Type<CanActivate> | CanActivate>;
    },
    apiBasePath: string,
    authProvider: Provider,
    imports?: DynamicModule['imports'],
  ): DynamicModule {
    const basePath = normalize(options.basePath ?? '/media');
    const actions = options.actions === true;
    // MediaDashboardUiController ships with no guard of its own, so this is a plain REPLACE (base
    // `[]`) — matches `MediaConsoleApiModule`'s own `stampGuards` call for the read/action
    // controllers, which DOES have a built-in base to append onto.
    stampGuards(options.guards, [[MediaDashboardUiController, []]]);
    return {
      module: MediaDashboardModule,
      imports: [
        ...(imports ?? []),
        MediaConsoleApiModule.register({
          actions,
          cookiePath: apiBasePath,
          authProvider,
          imports,
          ...(options.guards ? { guards: options.guards } : {}),
        }),
        RouterModule.register([
          { path: basePath, module: MediaDashboardModule }, // the UI controller below
          { path: apiBasePath, module: MediaConsoleApiModule },
        ]),
      ],
      controllers: [MediaDashboardUiController],
      providers: [
        { provide: MEDIA_DASHBOARD_BASE_PATH, useValue: basePath },
        { provide: MEDIA_DASHBOARD_API_PATH, useValue: apiBasePath },
        // MediaDashboardUiController is hosted HERE, so its guards DI-instantiate from this
        // module — class guards need a provider; an already-instantiated guard needs none.
        ...(options.guards ?? []).filter(isGuardClass),
      ],
      // Re-export the API module so its MediaConsoleService reaches importers if they want it.
      exports: [MediaConsoleApiModule],
    };
  }
}
