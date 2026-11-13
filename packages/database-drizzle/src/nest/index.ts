// `@dudousxd/nestjs-media-database-drizzle/nest` — stores built from a `@nestjs/drizzle`
// connection. Its own entry so the root and `/pg` never load `@nestjs/drizzle` (an optional peer).
import { getDrizzleToken } from '@nestjs/drizzle';
import { DrizzleMediaStore } from '../drizzle-media-store';
import type { DrizzlePgDatabase } from '../pg/db';
import { DrizzlePgMediaStore } from '../pg/drizzle-pg-media-store';
import { DrizzlePgUploadSessionStore } from '../pg/drizzle-pg-upload-session-store';
import { mediaPgTables } from '../pg/schema';
import { rejectSqliteSchema } from '../schema-name';

export interface DrizzleConnectionOptions {
  /** The `@nestjs/drizzle` connection (`DrizzleModule.forRoot({ name })`). Default: the default one. */
  connectionName?: string;
  /**
   * The Postgres schema of the media tables; every statement names it (`search_path` is never
   * used). Default: unqualified. On SQLite it throws: SQLite has no schemas.
   */
  schema?: string;
}

/** What `MediaModule.forRoot({ store, uploadSessions })` accepts as a factory. */
export interface DrizzleStoreFactory<T> {
  inject: string[];
  useFactory: (db: any) => T;
}

/** The store options of a factory; the name is checked when the module is declared. */
function storeOptions(options: DrizzleConnectionOptions): { schema?: string } {
  if (options.schema === undefined) return {};
  mediaPgTables(options.schema);
  return { schema: options.schema };
}

function factory<T>(
  options: DrizzleConnectionOptions,
  build: (db: any) => T,
): DrizzleStoreFactory<T> {
  return { inject: [getDrizzleToken(options.connectionName)], useFactory: build };
}

/** The SQLite/libSQL media store on a `@nestjs/drizzle` connection. */
export function drizzleMediaStore(
  options: DrizzleConnectionOptions = {},
): DrizzleStoreFactory<DrizzleMediaStore> {
  rejectSqliteSchema(options.schema);
  return factory(options, (db) => new DrizzleMediaStore(db));
}

/**
 * The PostgreSQL media store on a `@nestjs/drizzle` connection:
 *
 * ```ts
 * MediaModule.forRoot({
 *   store: drizzlePgMediaStore({ connectionName: 'media' }),
 *   uploadSessions: drizzlePgUploadSessions({ connectionName: 'media' }),
 * })
 * ```
 */
export function drizzlePgMediaStore(
  options: DrizzleConnectionOptions = {},
): DrizzleStoreFactory<DrizzlePgMediaStore> {
  const store = storeOptions(options);
  return factory(options, (db: DrizzlePgDatabase) => new DrizzlePgMediaStore(db, store));
}

/** The PostgreSQL upload session store on a `@nestjs/drizzle` connection. */
export function drizzlePgUploadSessions(
  options: DrizzleConnectionOptions = {},
): DrizzleStoreFactory<DrizzlePgUploadSessionStore> {
  const store = storeOptions(options);
  return factory(options, (db: DrizzlePgDatabase) => new DrizzlePgUploadSessionStore(db, store));
}
