import { sql } from 'drizzle-orm';
import { assertSchemaName, qualified } from '../schema-name';
import type { DrizzlePgDatabase } from './db';

/**
 * Postgres DDL for the media tables (`mediaPgTables(schema)`), in `schema` when given: a
 * `CREATE SCHEMA IF NOT EXISTS` first, then every table, reference and index qualified with it.
 * Idempotent (`IF NOT EXISTS`). Production hosts normally generate migrations with drizzle-kit
 * from the exported tables instead.
 */
export function mediaPgDdl(schema?: string): string[] {
  if (schema !== undefined) assertSchemaName(schema);
  const t = (table: string) => qualified(schema, table);
  return [
    ...(schema !== undefined ? [`CREATE SCHEMA IF NOT EXISTS "${schema}"`] : []),
    `CREATE TABLE IF NOT EXISTS ${t('media')} (
    "id" text PRIMARY KEY NOT NULL,
    "owner_type" text NOT NULL,
    "owner_id" text NOT NULL,
    "collection" text NOT NULL,
    "name" text NOT NULL,
    "file_name" text NOT NULL,
    "mime_type" text NOT NULL,
    "size" bigint NOT NULL,
    "disk" text NOT NULL,
    "path" text NOT NULL,
    "position" integer NOT NULL,
    "custom_properties" jsonb NOT NULL,
    "conversions" jsonb NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "tenant_id" text
  )`,
    `ALTER TABLE ${t('media')} ADD COLUMN IF NOT EXISTS "tenant_id" text`,
    `CREATE INDEX IF NOT EXISTS "idx_media_owner" ON ${t('media')} ("owner_type", "owner_id", "collection")`,
    `CREATE INDEX IF NOT EXISTS "idx_media_collection" ON ${t('media')} ("collection")`,
    `CREATE INDEX IF NOT EXISTS "idx_media_disk" ON ${t('media')} ("disk")`,
    `CREATE INDEX IF NOT EXISTS "idx_media_created_at" ON ${t('media')} ("created_at")`,
    `CREATE INDEX IF NOT EXISTS "idx_media_collection_created_at" ON ${t('media')} ("collection", "created_at", "id")`,
    `CREATE INDEX IF NOT EXISTS "idx_media_tenant" ON ${t('media')} ("tenant_id", "owner_type", "owner_id", "collection")`,
    `CREATE TABLE IF NOT EXISTS ${t('media_upload_sessions')} (
    "id" text PRIMARY KEY NOT NULL,
    "disk" text NOT NULL,
    "key" text NOT NULL,
    "content_type" text,
    "size" bigint,
    "offset" bigint DEFAULT 0 NOT NULL,
    "parts" integer DEFAULT 0 NOT NULL,
    "multipart_upload_id" text,
    "metadata" jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "tenant_id" text
  )`,
    `ALTER TABLE ${t('media_upload_sessions')} ADD COLUMN IF NOT EXISTS "tenant_id" text`,
    `CREATE INDEX IF NOT EXISTS "idx_media_upload_sessions_tenant" ON ${t('media_upload_sessions')} ("tenant_id")`,
    `CREATE TABLE IF NOT EXISTS ${t('media_upload_parts')} (
    "session_id" text NOT NULL REFERENCES ${t('media_upload_sessions')} ("id") ON DELETE CASCADE,
    "part_number" integer NOT NULL,
    "etag" text NOT NULL,
    PRIMARY KEY ("session_id", "part_number")
  )`,
  ];
}

/** The DDL of the unqualified tables (`mediaPgDdl()`). */
export const MEDIA_PG_DDL: readonly string[] = mediaPgDdl();

/**
 * Create the media + upload-session tables and indexes if they don't exist. A convenience for
 * tests and quick dev setups — Drizzle is migration-first, so production hosts should generate
 * migrations with drizzle-kit from the tables of `mediaPgTables(schema)`. With `schema`, the
 * schema is created first and every statement names it; without, tables land in the connection's
 * current schema.
 */
export async function createMediaPgTables(
  db: DrizzlePgDatabase,
  options: { schema?: string } = {},
): Promise<void> {
  const [first, ...rest] = mediaPgDdl(options.schema);
  if (options.schema !== undefined && first !== undefined) {
    try {
      await db.execute(sql.raw(first));
    } catch (error) {
      throw Object.assign(
        new Error(
          `[nestjs-media] could not create the schema "${options.schema}". Create it yourself, or grant the role CREATE on the database: GRANT CREATE ON DATABASE <db> TO <role>. (${(error as Error).message})`,
        ),
        { cause: error },
      );
    }
  }
  for (const statement of options.schema !== undefined ? rest : [first, ...rest]) {
    if (statement !== undefined) await db.execute(sql.raw(statement));
  }
}
