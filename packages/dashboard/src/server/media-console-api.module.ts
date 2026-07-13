import {
  type CanActivate,
  type DynamicModule,
  Module,
  type ModuleMetadata,
  type Provider,
  type Type,
} from '@nestjs/common';
import { baseGuards, isGuardClass, stampGuards } from './guards.js';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleAuthController } from './media-console-auth.controller.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';
import { MediaConsoleGuard } from './media-console.guard.js';
import { MediaConsoleService } from './media-console.service.js';
import { MEDIA_CONSOLE_COOKIE_PATH, MEDIA_DASHBOARD_ACTIONS } from './tokens.js';

/**
 * `MediaConsoleReadController`/`MediaConsoleActionsController`'s own, pristine
 * `@UseGuards(MediaConsoleGuard)` metadata, captured once at module-load time — the baseline every
 * `register()` call's host `guards` append onto (see `stampGuards` in `./guards.js`).
 */
const READ_BASE_GUARDS = baseGuards(MediaConsoleReadController);
const ACTIONS_BASE_GUARDS = baseGuards(MediaConsoleActionsController);

interface ApiModuleOptions {
  actions: boolean;
  /** Cookie `Path` — the JSON API base — so the session cookie rides every console API request. */
  cookiePath: string;
  /** Provider for `MEDIA_CONSOLE_AUTH` — a `useValue` (forRoot) or a `useFactory` (forRootAsync). */
  authProvider: Provider;
  /** Extra imports the auth factory's `inject` deps (or a guard class's own deps) live in. */
  imports?: ModuleMetadata['imports'];
  /**
   * Guard classes (or instances) fronting the read + action controllers — APPENDED to their own
   * built-in `MediaConsoleGuard` (session-cookie) gate, so a request must pass BOTH. Deliberately
   * NOT applied to `MediaConsoleAuthController`: it MINTS the session cookie the built-in gate (and
   * any host guard reusing that same cookie) checks for, so it can't be made to require the very
   * auth it grants — mirrors `@dudousxd/nestjs-telescope`'s own auth controller staying outside its
   * `stampGuards` call.
   */
  guards?: Array<Type<CanActivate> | CanActivate>;
}

/**
 * Holds the console's JSON API: the read controller (always), the actions controller (only when
 * `actions: true`), and the auth controller (always — it mints the session the guard checks, so it
 * is never itself guarded). The read/action controllers carry `MediaConsoleGuard`, a no-op unless
 * the host configured `auth`, plus any host `guards` (see {@link ApiModuleOptions.guards}) — both
 * gates must pass.
 */
@Module({})
export class MediaConsoleApiModule {
  static register(options: ApiModuleOptions): DynamicModule {
    stampGuards(options.guards, [
      [MediaConsoleReadController, READ_BASE_GUARDS],
      [MediaConsoleActionsController, ACTIONS_BASE_GUARDS],
    ]);
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
        // Class guards need a DI provider so Nest can instantiate them in THIS module's context
        // (where `imports` above resolves their dependencies). An already-instantiated guard needs
        // none — it's used as-is.
        ...(options.guards ?? []).filter(isGuardClass),
      ],
      exports: [MediaConsoleService],
    };
  }
}
