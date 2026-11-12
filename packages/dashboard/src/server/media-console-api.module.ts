import { type DynamicModule, Module, type ModuleMetadata, type Provider } from '@nestjs/common';
import { type ConsoleAuthorize, consoleAuthorizeProvider } from './console-authorize.js';
import { consoleController } from './controller-decorators.js';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';
import { MediaConsoleService } from './media-console.service.js';
import type { ObjectUrlConfig } from './object-urls.js';
import {
  MEDIA_CONSOLE_AUTHORIZE,
  MEDIA_CONSOLE_OBJECT_INSIGHTS,
  MEDIA_CONSOLE_OBJECT_URLS,
  MEDIA_DASHBOARD_ACTIONS,
} from './tokens.js';

export interface MediaConsoleApiModuleOptions {
  actions: boolean;
  /** Provider for `MEDIA_CONSOLE_OBJECT_INSIGHTS` — the host's object-annotation providers.
   *  Omitted binds the empty list, which is the no-op the console renders nothing for. */
  insightsProvider?: Provider;
  /** Resolved object-URL strategy + the API mount it builds proxy URLs against. */
  objectUrls: ObjectUrlConfig;
  /** Extra imports the insights factory's `inject` deps (or a decorator's guards' deps) live in. */
  imports?: ModuleMetadata['imports'];
  /**
   * Who may use the console API — see `MediaDashboardOptions.authorize`. Omitted: open outside
   * production, every request answers 403 in production, and one warning is logged at boot.
   */
  authorize?: ConsoleAuthorize;
  /** The registration named in the boot warning when `authorize` is omitted. Default
   *  `'MediaConsoleApiModule.register'`. */
  moduleName?: string;
  /**
   * Class decorators applied to EVERY controller this module mounts (read, actions) — see
   * `MediaDashboardOptions.decorators`. Each call decorates fresh subclasses, never the shared
   * classes, so decorators never leak from one registration into the next.
   */
  decorators?: ClassDecorator[];
  /**
   * `false` registers no controller, only the providers (exported), for a host that mounts the
   * controllers itself — see `MediaDashboardOptions.routes`. Default `true`.
   */
  routes?: boolean;
}

/**
 * Holds the console's JSON API: the read controller (always) and the actions controller (only when
 * `actions: true`). Who reaches them is decided by `authorize` (`ConsoleAuthorizeGuard`).
 */
@Module({})
export class MediaConsoleApiModule {
  static register(options: MediaConsoleApiModuleOptions): DynamicModule {
    return {
      module: MediaConsoleApiModule,
      imports: options.imports ?? [],
      controllers:
        options.routes === false
          ? []
          : [
              consoleController(MediaConsoleReadController, options.decorators),
              ...(options.actions
                ? [consoleController(MediaConsoleActionsController, options.decorators)]
                : []),
            ],
      providers: [
        MediaConsoleService,
        consoleAuthorizeProvider(
          options.authorize,
          options.moduleName ?? 'MediaConsoleApiModule.register',
        ),
        { provide: MEDIA_DASHBOARD_ACTIONS, useValue: options.actions },
        { provide: MEDIA_CONSOLE_OBJECT_URLS, useValue: options.objectUrls },
        options.insightsProvider ?? {
          provide: MEDIA_CONSOLE_OBJECT_INSIGHTS,
          useValue: [],
        },
      ],
      // For a host mounting the controllers itself (`routes: false`): its subclasses inject these, and
      // `ConsoleAuthorizeGuard` injects the resolved `authorize` check.
      exports: [MediaConsoleService, MEDIA_DASHBOARD_ACTIONS, MEDIA_CONSOLE_AUTHORIZE],
    };
  }
}
