import { getDrizzleToken } from '@nestjs/drizzle';
import { describe, expect, it } from 'vitest';
import { DrizzleMediaStore } from '../drizzle-media-store';
import { DrizzlePgMediaStore } from '../pg/drizzle-pg-media-store';
import { DrizzlePgUploadSessionStore } from '../pg/drizzle-pg-upload-session-store';
import { drizzleMediaStore, drizzlePgMediaStore, drizzlePgUploadSessions } from './index';

describe('@nestjs/drizzle store factories', () => {
  it('inject the named connection and build each store on it', () => {
    const db = {};
    for (const [factory, type] of [
      [drizzleMediaStore({ connectionName: 'media' }), DrizzleMediaStore],
      [drizzlePgMediaStore({ connectionName: 'media' }), DrizzlePgMediaStore],
      [drizzlePgUploadSessions({ connectionName: 'media' }), DrizzlePgUploadSessionStore],
    ] as const) {
      expect(factory.inject).toEqual([getDrizzleToken('media')]);
      expect(factory.useFactory(db)).toBeInstanceOf(type);
    }
  });

  it('defaults to the default connection', () => {
    expect(drizzlePgMediaStore().inject).toEqual([getDrizzleToken()]);
  });
});
