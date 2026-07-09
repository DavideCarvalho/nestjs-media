import { describe, expect, it } from 'vitest';
import { MEDIA_STORAGE_SHARED, MEDIA_STORE, MEDIA_UPLOAD_SESSIONS } from './media-tokens';

describe('media telescope tokens', () => {
  it('resolve to the shared global-registry symbols', () => {
    expect(MEDIA_STORE).toBe(Symbol.for('nestjs-media:store'));
    expect(MEDIA_UPLOAD_SESSIONS).toBe(Symbol.for('nestjs-media:upload-sessions'));
    expect(MEDIA_STORAGE_SHARED).toBe(Symbol.for('nestjs-media:storage'));
  });
});
