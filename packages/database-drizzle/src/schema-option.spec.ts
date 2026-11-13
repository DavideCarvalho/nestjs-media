import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { DrizzleMediaStore, createMediaTable } from './drizzle-media-store';
import { drizzleMediaStore, drizzlePgMediaStore, drizzlePgUploadSessions } from './nest';
import {
  type DrizzlePgDatabase,
  DrizzlePgMediaStore,
  DrizzlePgUploadSessionStore,
  MEDIA_PG_DDL,
  mediaPgDdl,
  mediaPgTables,
} from './pg';

describe('the `schema` option', () => {
  it('SQLite has no schemas: the store, the table helper and the module factory refuse it', () => {
    const db = drizzle(new Database(':memory:'));
    expect(() => new DrizzleMediaStore(db, { schema: 'media' })).toThrow(/SQLite has no schemas/);
    expect(() => createMediaTable(db, { schema: 'media' })).toThrow(/SQLite has no schemas/);
    expect(() => drizzleMediaStore({ schema: 'media' })).toThrow(/SQLite has no schemas/);
    expect(() => new DrizzleMediaStore(db)).not.toThrow();
  });

  it('validates the name, and refuses public (leave it unset)', () => {
    const db = {} as DrizzlePgDatabase;
    for (const bad of ['1x', 'a-b', 'a"b', 'x'.repeat(64), '']) {
      expect(() => new DrizzlePgMediaStore(db, { schema: bad })).toThrow(/must match/);
      expect(() => mediaPgDdl(bad)).toThrow(/must match/);
    }
    expect(() => new DrizzlePgUploadSessionStore(db, { schema: 'public' })).toThrow(
      /leave `schema` unset/,
    );
    expect(() => drizzlePgMediaStore({ schema: 'a-b' })).toThrow(/must match/);
    expect(() => new DrizzlePgMediaStore(db, { schema: 'Media_1$' })).not.toThrow();
  });

  it('builds qualified tables, and the unqualified set is unchanged', () => {
    const t = mediaPgTables('media');
    expect(getTableConfig(t.media).schema).toBe('media');
    expect(getTableConfig(t.uploadParts).schema).toBe('media');
    expect(getTableConfig(mediaPgTables().media).schema).toBeUndefined();
  });

  it('qualifies every DDL statement, and creates the schema first', () => {
    const ddl = mediaPgDdl('lib');
    expect(ddl[0]).toBe('CREATE SCHEMA IF NOT EXISTS "lib"');
    for (const statement of ddl.slice(1)) {
      expect(statement).not.toMatch(/(TABLE|ON|REFERENCES) (IF NOT EXISTS )?"media(_upload_\w+)?"/);
      expect(statement).toMatch(/"lib"\."media(_upload_\w+)?"/);
    }
    expect(MEDIA_PG_DDL.some((statement) => statement.includes('SCHEMA'))).toBe(false);
    expect(MEDIA_PG_DDL[0]).toContain('CREATE TABLE IF NOT EXISTS "media" (');
  });

  it('the module factories pass the schema to the stores', () => {
    const db = {} as DrizzlePgDatabase;
    const store = drizzlePgMediaStore({ schema: 'media' }).useFactory(db);
    const sessions = drizzlePgUploadSessions({ schema: 'media' }).useFactory(db);
    expect(store).toBeInstanceOf(DrizzlePgMediaStore);
    expect(sessions).toBeInstanceOf(DrizzlePgUploadSessionStore);
    expect(getTableConfig((store as unknown as { t: { media: never } }).t.media).schema).toBe(
      'media',
    );
  });
});
