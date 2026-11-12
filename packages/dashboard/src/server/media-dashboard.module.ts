import {
  type DynamicModule,
  Module,
  type OptionalFactoryDependency,
  type Provider,
} from '@nestjs/common';
import type { InjectionToken } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import type { ConsoleAuthorize } from './console-authorize.js';
import { MediaConsoleRegistration } from './console-switcher.js';
import { consoleController } from './controller-decorators.js';
import { MediaConsoleApiModule } from './media-console-api.module.js';
import { MediaDashboardUiController } from './media-dashboard-ui.controller.js';
import type { ObjectInsightProvider } from './object-insights.js';
import type { ObjectUrlStrategy } from './object-urls.js';
import {
  MEDIA_CONSOLE_OBJECT_INSIGHTS,
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
   * proxy rules while the UI stays at `basePath`.
   */
  apiBasePath?: string;
  /**
   * Enable the destructive endpoints (delete object/record, copy/move, abort upload). Default
   * `false` — the read API is always available.
   */
  actions?: boolean;
  /**
   * How the console reports the `url` for an object's bytes — the "Open ↗" link, and an image
   * variant's `src`. Default `'auto'`: presigned straight to the object store when the driver can
   * mint one. Set `'proxy'` when the browser has no path to the store (no network route, no CORS
   * grant, a policy against client-to-bucket traffic), and those URLs are routed same-origin
   * through this server instead. See {@link ObjectUrlStrategy}.
   *
   * Downloading is unaffected: `disks/:disk/object/download` is always same-origin.
   */
  objectUrls?: ObjectUrlStrategy;
  /**
   * Extra `imports` merged into the dashboard's dynamic module — the DI resolution path for the
   * dependencies of a guard passed through {@link decorators} (e.g. `UseGuards(AuthenticationGuard)`),
   * or any other provider the controllers need reachable.
   */
  imports?: DynamicModule['imports'];
  /**
   * Host-supplied context about a disk object, rendered in the console's preview — see
   * {@link ObjectInsightProvider}. The console can only describe a file as storage sees it; this is
   * how it learns what the file *means* to your app. Omit for no annotation (the default).
   *
   * Use `forRootAsync`'s `useObjectInsights` when a provider needs injected services.
   */
  objectInsights?: ObjectInsightProvider[];
  /**
   * Who may use the console: decided on EVERY console request (the page, its assets and the JSON
   * API) by a guard that runs after your `decorators`, so your authentication guards set
   * `request.user` first. Five forms:
   *
   * ```ts
   * authorize: (ctx) => ctx.switchToHttp().getRequest().user?.isAdmin === true,
   * authorize: ConsoleAccess,                              // @Injectable() implements ConsoleAuthorizer
   * authorize: () => import('./console-access.js'),        // lazy, default export
   * authorize: { policy: ConsolePolicy, ability: 'view' }, // @nestjs/authorization policy
   * authorize: 'console.media',                            // a gate from @dudousxd/nestjs-authz
   * ```
   *
   * Answer `true`/`{ allowed: true }` to allow, `false`/`{ allowed: false }` for 403,
   * `{ allowed: false, reason: 'unauthenticated' }` for 401, or `{ redirectTo: '/login' }` to send a
   * page navigation there (API calls get 401 with `redirectTo`). A throw is a 403.
   *
   * Omitted: open outside production; in production every request answers 403, and one warning is
   * logged at boot.
   *
   * This is the console's access. It is not `MediaModule`'s `authorize(user, action, subject)` hook,
   * which governs the product upload routes.
   */
  authorize?: ConsoleAuthorize;
  /**
   * Class decorators applied to EVERY controller the console mounts — the page/asset controller
   * and the read and action APIs — e.g.
   * `[UseGuards(AuthenticationGuard), Can(MediaPolicy, 'console')]` with the first-party
   * `@nestjs/authentication` / `@nestjs/authorization`. Default: none.
   *
   * Every console controller is marked `@Can.Anyone()`-open (`'authorization:can-anyone'`) so
   * `@nestjs/authorization`'s deny-by-default global guard doesn't refuse the console; a `Can(...)`
   * passed here is still checked (the guard treats `can-anyone` as open only when no requirement is
   * declared).
   *
   * `decorators` don't decide access on their own: use them for authentication, throttling and the
   * like, and {@link authorize} for who may use the console.
   *
   * Full-page navigations to `basePath` carry only cookies, never an `Authorization` header — a
   * guard here must be able to authenticate the page from a cookie, or every browser visit 401s.
   *
   * Each registration decorates fresh subclasses of the controllers, so one registration's
   * decorators never reach another.
   */
  decorators?: ClassDecorator[];
  /**
   * `false` mounts NO controller — no page, no JSON API — while every provider still works and is
   * exported (`MediaConsoleService`, the resolved paths), so you serve
   * the console from controllers of your own by extending the exported controller classes. Apply
   * `UseConsoleAuthorize()` to them, ABOVE your authentication guard (class decorators apply
   * bottom-up, so authentication runs first), so {@link authorize} still decides access. Keep
   * `basePath`/`apiBasePath` equal to where you mount them: the SPA reads both.
   *
   * ```ts
   * @UseConsoleAuthorize()
   * @UseGuards(AuthGuard)
   * @Controller('media/api')
   * export class ConsoleApiController extends MediaConsoleReadController {}
   * ```
   *
   * Default `true`.
   */
  routes?: boolean;
  /**
   * Register the console's reads (and, with `actions: true`, its upload abort and object delete) as
   * developer tools on the agent MCP server's dev endpoint (`/mcp/aviary`), gated by this console's
   * `authorize`. Default: on when the console's routes are mounted, off with `routes: false`.
   */
  devTools?: boolean;
}

/**
 * Async variant of {@link MediaDashboardOptions}. The mount paths, `actions` and `decorators` stay
 * static (the router needs them at module-definition time); the `objectInsights` providers are
 * built by an injected factory, so they can reach your repositories and services.
 */
export interface MediaDashboardAsyncOptions {
  basePath?: string;
  apiBasePath?: string;
  actions?: boolean;
  /** See {@link MediaDashboardOptions.objectUrls}. Static like the mount paths and `actions` —
   *  it is read at module-definition time, not per request. */
  objectUrls?: ObjectUrlStrategy;
  /** Modules exporting the providers `inject` needs, or a decorator guard's own dependencies (omit
   *  when they're global). */
  imports?: DynamicModule['imports'];
  /** Providers injected into `useObjectInsights`, in order. */
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  /**
   * Build the {@link MediaDashboardOptions.objectInsights} providers from injected deps — the usual
   * case, since a provider that says anything interesting needs a repository or a service.
   */
  useObjectInsights?: (
    ...deps: any[]
  ) => ObjectInsightProvider[] | Promise<ObjectInsightProvider[]>;
  /**
   * See {@link MediaDashboardOptions.decorators}. Static (not built by a factory): the decorators
   * shape the routes when the module is built.
   */
  decorators?: ClassDecorator[];
  /** See {@link MediaDashboardOptions.authorize}. Static, like `decorators`. */
  authorize?: ConsoleAuthorize;
  /** See {@link MediaDashboardOptions.routes}. Static, like `decorators`. */
  routes?: boolean;
  /** See {@link MediaDashboardOptions.devTools}. */
  devTools?: boolean;
}

/** Leading slash, no trailing slash. */
function normalize(path: string): string {
  return `/${path.replace(/^\/+|\/+$/g, '')}`;
}

/**
 * Mounts the /media console: the bundled React SPA at `basePath` and its JSON API at `apiBasePath`
 * (default `<basePath>/api`). Import via `MediaDashboardModule.forRoot(...)` (or `forRootAsync` when
 * the `objectInsights` providers need injected services) alongside `MediaModule` (global), so it
 * resolves the storage/store/upload tokens. Exclude the UI/API paths from any global `/api` prefix.
 *
 * Decide who may use it with {@link MediaDashboardOptions.authorize}; without it the console is open
 * outside production and answers 403 to everything in production.
 */
@Module({})
export class MediaDashboardModule {
  static forRoot(options: MediaDashboardOptions = {}): DynamicModule {
    return MediaDashboardModule.build('MediaDashboardModule.forRoot()', options, {
      provide: MEDIA_CONSOLE_OBJECT_INSIGHTS,
      useValue: options.objectInsights ?? [],
    });
  }

  static forRootAsync(options: MediaDashboardAsyncOptions = {}): DynamicModule {
    return MediaDashboardModule.build('MediaDashboardModule.forRootAsync()', options, {
      provide: MEDIA_CONSOLE_OBJECT_INSIGHTS,
      inject: options.inject ?? [],
      useFactory: async (...deps: any[]) =>
        options.useObjectInsights === undefined ? [] : await options.useObjectInsights(...deps),
    });
  }

  /** Shared wiring: static routing + the API module, with the insights from the given provider. */
  private static build(
    name: string,
    options: {
      basePath?: string;
      apiBasePath?: string;
      actions?: boolean;
      objectUrls?: ObjectUrlStrategy;
      imports?: DynamicModule['imports'];
      authorize?: ConsoleAuthorize;
      decorators?: ClassDecorator[];
      routes?: boolean;
      devTools?: boolean;
    },
    insightsProvider: Provider,
  ): DynamicModule {
    const basePath = normalize(options.basePath ?? '/media');
    const apiBasePath = normalize(options.apiBasePath ?? `${basePath}/api`);
    const actions = options.actions === true;
    const mount = options.routes !== false;
    const imports = options.imports;
    return {
      module: MediaDashboardModule,
      imports: [
        ...(imports ?? []),
        MediaConsoleApiModule.register({
          actions,
          objectUrls: { strategy: options.objectUrls ?? 'auto', apiBasePath },
          insightsProvider,
          imports,
          ...(options.authorize !== undefined ? { authorize: options.authorize } : {}),
          moduleName: name,
          ...(options.decorators ? { decorators: options.decorators } : {}),
          routes: mount,
          ...(options.devTools !== undefined ? { devTools: options.devTools } : {}),
        }),
        ...(mount
          ? [
              RouterModule.register([
                { path: basePath, module: MediaDashboardModule }, // the UI controller below
                { path: apiBasePath, module: MediaConsoleApiModule },
              ]),
            ]
          : []),
      ],
      controllers: mount ? [consoleController(MediaDashboardUiController, options.decorators)] : [],
      providers: [
        { provide: MEDIA_DASHBOARD_BASE_PATH, useValue: basePath },
        { provide: MEDIA_DASHBOARD_API_PATH, useValue: apiBasePath },
        // The console switcher lists this console only where it serves its own page.
        ...(mount ? [MediaConsoleRegistration] : []),
      ],
      // Re-export the API module so its MediaConsoleService reaches importers if they want it; the
      // resolved paths too, so a host mounting the controllers itself (`routes: false`) can extend
      // `MediaDashboardUiController` in a module of its own.
      exports: [MediaConsoleApiModule, MEDIA_DASHBOARD_BASE_PATH, MEDIA_DASHBOARD_API_PATH],
    };
  }
}
