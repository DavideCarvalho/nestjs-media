import { describe, expect, it } from 'vitest';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleApiModule } from './media-console-api.module.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';

describe('MediaConsoleApiModule.register', () => {
  it('mounts only the read controller when actions are disabled', () => {
    const module = MediaConsoleApiModule.register(false);
    expect(module.controllers).toEqual([MediaConsoleReadController]);
  });

  it('mounts the actions controller when actions are enabled', () => {
    const module = MediaConsoleApiModule.register(true);
    expect(module.controllers).toContain(MediaConsoleReadController);
    expect(module.controllers).toContain(MediaConsoleActionsController);
    expect(module.controllers).toHaveLength(2);
  });
});
