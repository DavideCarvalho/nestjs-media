import { type DynamicModule, Module, type ModuleMetadata, type Provider } from '@nestjs/common';
import { assertRoutesProtected, decoratedController } from './controller-decorators.js';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';
import { MediaConsoleService } from './media-console.service.js';
import type { ObjectUrlConfig } from './object-urls.js';
import {
  MEDIA_CONSOLE_OBJECT_INSIGHTS,
  MEDIA_CONSOLE_OBJECT_URLS,
  MEDIA_DASHBOARD_ACTIONS,
} from './tokens.js';

interface ApiModuleOptions {
  actions: boolean;
  /** Provider for `MEDIA_CONSOLE_OBJECT_INSIGHTS` — the host's object-annotation providers.
   *  Omitted binds the empty list, which is the no-op the console renders nothing for. */
  insightsProvider?: Provider;
  /** Resolved object-URL strategy + the API mount it builds proxy URLs against. */
  objectUrls: ObjectUrlConfig;
  /** Extra imports the insights factory's `inject` deps (or a decorator's guards' deps) live in. */
  imports?: ModuleMetadata['imports'];
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
 * `actions: true`). Who reaches them is the host's call — `decorators`, or its own controllers.
 */
@Module({})
export class MediaConsoleApiModule {
  static register(options: ApiModuleOptions): DynamicModule {
    assertRoutesProtected({
      module: 'MediaConsoleApiModule.register',
      mountsRoutes: options.routes !== false,
      decorators: options.decorators,
      decoratorsExample:
        "MediaConsoleApiModule.register({ ..., decorators: [UseGuards(AuthenticationGuard), Can(MediaPolicy, 'console')] })",
      selfMountExample:
        "MediaConsoleApiModule.register({ ..., routes: false }) + @Can(MediaPolicy, 'console') @Controller('media/api') class ConsoleApiController extends MediaConsoleReadController {}",
    });
    return {
      module: MediaConsoleApiModule,
      imports: options.imports ?? [],
      controllers:
        options.routes === false
          ? []
          : [
              decoratedController(MediaConsoleReadController, options.decorators),
              ...(options.actions
                ? [decoratedController(MediaConsoleActionsController, options.decorators)]
                : []),
            ],
      providers: [
        MediaConsoleService,
        { provide: MEDIA_DASHBOARD_ACTIONS, useValue: options.actions },
        { provide: MEDIA_CONSOLE_OBJECT_URLS, useValue: options.objectUrls },
        options.insightsProvider ?? {
          provide: MEDIA_CONSOLE_OBJECT_INSIGHTS,
          useValue: [],
        },
      ],
      // For a host mounting the controllers itself (`routes: false`): its subclasses inject these.
      exports: [MediaConsoleService, MEDIA_DASHBOARD_ACTIONS],
    };
  }
}
