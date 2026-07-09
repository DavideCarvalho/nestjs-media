import { type DynamicModule, Module } from '@nestjs/common';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';
import { MediaConsoleService } from './media-console.service.js';
import { MEDIA_DASHBOARD_ACTIONS } from './tokens.js';

/**
 * Holds the console's JSON API controllers + the read/action service, mounted on its own path by
 * `MediaDashboardModule.forRoot`. The destructive actions controller is only registered when the
 * host opts in via `{ actions: true }`.
 */
@Module({})
export class MediaConsoleApiModule {
  static register(actions: boolean): DynamicModule {
    return {
      module: MediaConsoleApiModule,
      controllers: actions
        ? [MediaConsoleReadController, MediaConsoleActionsController]
        : [MediaConsoleReadController],
      providers: [MediaConsoleService, { provide: MEDIA_DASHBOARD_ACTIONS, useValue: actions }],
      exports: [MediaConsoleService],
    };
  }
}
