import { describe, expect, it } from 'vitest';
import { MediaConsoleActionsController } from './media-console-actions.controller.js';
import { MediaConsoleApiModule } from './media-console-api.module.js';
import { MediaConsoleAuthController } from './media-console-auth.controller.js';
import { MediaConsoleReadController } from './media-console-read.controller.js';
import { MEDIA_CONSOLE_AUTH } from './tokens.js';

const base = {
  // Not `apiBasePath`: the session cookie is scoped to `/` so it reaches the SPA shell and the
  // JSON API even when a host mounts them at unrelated paths. See media-console-cookie-scope.spec.
  cookiePath: '/',
  authProvider: { provide: MEDIA_CONSOLE_AUTH, useValue: null },
};

describe('MediaConsoleApiModule.register', () => {
  it('mounts the read + auth controllers when actions are disabled', () => {
    const module = MediaConsoleApiModule.register({ ...base, actions: false });
    expect(module.controllers).toEqual([MediaConsoleReadController, MediaConsoleAuthController]);
  });

  it('mounts the actions controller when actions are enabled', () => {
    const module = MediaConsoleApiModule.register({ ...base, actions: true });
    expect(module.controllers).toContain(MediaConsoleReadController);
    expect(module.controllers).toContain(MediaConsoleActionsController);
    expect(module.controllers).toContain(MediaConsoleAuthController);
    expect(module.controllers).toHaveLength(3);
  });
});
