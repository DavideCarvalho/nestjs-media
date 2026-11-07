import {
  type DynamicModule,
  Module,
  type OptionalFactoryDependency,
  type Provider,
} from '@nestjs/common';
import type { InjectionToken } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { assertRoutesProtected, decoratedController } from './controller-decorators.js';
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
   * In production (`NODE_ENV === 'production'`) a registration that mounts the console with no
   * `decorators` refuses to boot — protect it here, or mount it yourself with `routes: false`.
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
   * the console from controllers of your own, protected with ordinary Nest decorators, by extending
   * the exported controller classes. Keep `basePath`/`apiBasePath` equal to where you mount them:
   * the SPA reads both.
   *
   * ```ts
   * @Can(MediaPolicy, 'console')
   * @Controller('media/api')
   * export class ConsoleApiController extends MediaConsoleReadController {}
   * ```
   *
   * Default `true`.
   */
  routes?: boolean;
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
  /** See {@link MediaDashboardOptions.routes}. Static, like `decorators`. */
  routes?: boolean;
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
 * Protect it with {@link MediaDashboardOptions.decorators}, or mount it yourself with
 * `routes: false` — in production one of the two is required.
 */
@Module({})
export class MediaDashboardModule {
  static forRoot(options: MediaDashboardOptions = {}): DynamicModule {
    return MediaDashboardModule.build('MediaDashboardModule.forRoot', options, {
      provide: MEDIA_CONSOLE_OBJECT_INSIGHTS,
      useValue: options.objectInsights ?? [],
    });
  }

  static forRootAsync(options: MediaDashboardAsyncOptions = {}): DynamicModule {
    return MediaDashboardModule.build('MediaDashboardModule.forRootAsync', options, {
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
      decorators?: ClassDecorator[];
      routes?: boolean;
    },
    insightsProvider: Provider,
  ): DynamicModule {
    const basePath = normalize(options.basePath ?? '/media');
    const apiBasePath = normalize(options.apiBasePath ?? `${basePath}/api`);
    const actions = options.actions === true;
    const mount = options.routes !== false;
    assertRoutesProtected({
      module: name,
      mountsRoutes: mount,
      decorators: options.decorators,
      decoratorsExample:
        "MediaDashboardModule.forRoot({ decorators: [UseGuards(AuthenticationGuard), Can(MediaPolicy, 'console')] })",
      selfMountExample:
        "MediaDashboardModule.forRoot({ routes: false }) + @Can(MediaPolicy, 'console') @Controller('media/api') class ConsoleApiController extends MediaConsoleReadController {}",
    });
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
          ...(options.decorators ? { decorators: options.decorators } : {}),
          routes: mount,
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
      controllers: mount
        ? [decoratedController(MediaDashboardUiController, options.decorators)]
        : [],
      providers: [
        { provide: MEDIA_DASHBOARD_BASE_PATH, useValue: basePath },
        { provide: MEDIA_DASHBOARD_API_PATH, useValue: apiBasePath },
      ],
      // Re-export the API module so its MediaConsoleService reaches importers if they want it; the
      // resolved paths too, so a host mounting the controllers itself (`routes: false`) can extend
      // `MediaDashboardUiController` in a module of its own.
      exports: [MediaConsoleApiModule, MEDIA_DASHBOARD_BASE_PATH, MEDIA_DASHBOARD_API_PATH],
    };
  }
}
