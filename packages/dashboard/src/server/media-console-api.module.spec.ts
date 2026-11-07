import { describe, expect, it } from 'vitest';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleApiModule } from './media-console-api.module.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';

const base = {
  objectUrls: { strategy: 'auto' as const, apiBasePath: '/api/media' },
};

describe('MediaConsoleApiModule.register', () => {
  it('mounts the read controller when actions are disabled', () => {
    const module = MediaConsoleApiModule.register({ ...base, actions: false });
    expect(module.controllers).toEqual([MediaConsoleReadController]);
  });

  it('mounts the actions controller when actions are enabled', () => {
    const module = MediaConsoleApiModule.register({ ...base, actions: true });
    expect(module.controllers).toEqual([MediaConsoleReadController, MediaConsoleActionsController]);
  });
});
