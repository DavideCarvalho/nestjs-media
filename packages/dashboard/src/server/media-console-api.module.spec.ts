import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { ConsoleAuthorizeGuard } from './console-authorize.js';
import { MediaConsolesController } from './console-switcher.js';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleApiModule } from './media-console-api.module.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';

const base = {
  objectUrls: { strategy: 'auto' as const, apiBasePath: '/api/media' },
};

const parents = (controllers: unknown[] | undefined): unknown[] =>
  (controllers ?? []).map((c) => Object.getPrototypeOf(c));

describe('MediaConsoleApiModule.register', () => {
  it('mounts the read controller when actions are disabled', () => {
    const module = MediaConsoleApiModule.register({ ...base, actions: false });
    expect(parents(module.controllers)).toEqual([
      MediaConsoleReadController,
      MediaConsolesController,
    ]);
  });

  it('mounts the actions controller when actions are enabled', () => {
    const module = MediaConsoleApiModule.register({ ...base, actions: true });
    expect(parents(module.controllers)).toEqual([
      MediaConsoleReadController,
      MediaConsolesController,
      MediaConsoleActionsController,
    ]);
  });

  it('guards every mounted controller with ConsoleAuthorizeGuard, after the host decorators', () => {
    class AuthGuard {}
    const host: ClassDecorator = (target) => {
      Reflect.defineMetadata(GUARDS_METADATA, [AuthGuard], target);
    };
    const module = MediaConsoleApiModule.register({ ...base, actions: true, decorators: [host] });
    for (const controller of module.controllers as Type[]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
        AuthGuard,
        ConsoleAuthorizeGuard,
      ]);
    }
    expect(Reflect.getMetadata(GUARDS_METADATA, MediaConsoleReadController)).toBeUndefined();
  });

  it('mounts nothing with routes: false', () => {
    expect(
      MediaConsoleApiModule.register({ ...base, actions: true, routes: false }).controllers,
    ).toEqual([]);
  });
});
