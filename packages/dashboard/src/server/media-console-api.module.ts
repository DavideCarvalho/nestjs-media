import { type DynamicModule, Module, type ModuleMetadata, type Provider } from '@nestjs/common';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleAuthController } from './media-console-auth.controller.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';
import { MediaConsoleGuard } from './media-console.guard.js';
import { MediaConsoleService } from './media-console.service.js';
import { MEDIA_CONSOLE_COOKIE_PATH, MEDIA_DASHBOARD_ACTIONS } from './tokens.js';

interface ApiModuleOptions {
  actions: boolean;
  /** Cookie `Path` — the JSON API base — so the session cookie rides every console API request. */
  cookiePath: string;
  /** Provider for `MEDIA_CONSOLE_AUTH` — a `useValue` (forRoot) or a `useFactory` (forRootAsync). */
  authProvider: Provider;
  /** Extra imports the auth factory's `inject` deps live in (empty when they're global). */
  imports?: ModuleMetadata['imports'];
}

/**
 * Holds the console's JSON API: the read controller (always), the actions controller (only when
 * `actions: true`), and the auth controller (always — it mints the session the guard checks, so it
 * is never itself guarded). The read/action controllers carry `MediaConsoleGuard`, a no-op unless
 * the host configured `auth`.
 */
@Module({})
export class MediaConsoleApiModule {
  static register(options: ApiModuleOptions): DynamicModule {
    return {
      module: MediaConsoleApiModule,
      imports: options.imports ?? [],
      controllers: [
        MediaConsoleReadController,
        MediaConsoleAuthController,
        ...(options.actions ? [MediaConsoleActionsController] : []),
      ],
      providers: [
        MediaConsoleService,
        MediaConsoleGuard,
        { provide: MEDIA_DASHBOARD_ACTIONS, useValue: options.actions },
        { provide: MEDIA_CONSOLE_COOKIE_PATH, useValue: options.cookiePath },
        options.authProvider,
      ],
      exports: [MediaConsoleService],
    };
  }
}
