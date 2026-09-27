import type { PgDatabase } from 'drizzle-orm/pg-core';

/**
 * Any drizzle Postgres database — node-postgres (`NodePgDatabase`), postgres-js, neon, pglite, …
 * and transactions of those. Kept deliberately loose so hosts on any drizzle Postgres driver /
 * schema generic can pass their `db` handle straight in.
 */
export type DrizzlePgDatabase = PgDatabase<any, any, any>;
