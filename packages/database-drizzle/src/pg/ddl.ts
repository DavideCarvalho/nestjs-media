import { sql } from 'drizzle-orm';
import type { DrizzlePgDatabase } from './db';

/**
 * Postgres DDL for the tables exported from `./schema` (`mediaPgTable`,
 * `mediaUploadSessionsPgTable`, `mediaUploadPartsPgTable`). Idempotent (`IF NOT EXISTS`).
 * Production hosts normally generate migrations with drizzle-kit from the exported tables instead.
 */
export const MEDIA_PG_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "media" (
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
    "updated_at" timestamp with time zone NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_media_owner" ON "media" ("owner_type", "owner_id", "collection")`,
  `CREATE INDEX IF NOT EXISTS "idx_media_collection" ON "media" ("collection")`,
  `CREATE INDEX IF NOT EXISTS "idx_media_disk" ON "media" ("disk")`,
  `CREATE INDEX IF NOT EXISTS "idx_media_created_at" ON "media" ("created_at")`,
  `CREATE INDEX IF NOT EXISTS "idx_media_collection_created_at" ON "media" ("collection", "created_at", "id")`,
  `CREATE TABLE IF NOT EXISTS "media_upload_sessions" (
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
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "media_upload_parts" (
    "session_id" text NOT NULL REFERENCES "media_upload_sessions" ("id") ON DELETE CASCADE,
    "part_number" integer NOT NULL,
    "etag" text NOT NULL,
    PRIMARY KEY ("session_id", "part_number")
  )`,
];

/**
 * Create the media + upload-session tables and indexes if they don't exist. A convenience for
 * tests and quick dev setups — Drizzle is migration-first, so production hosts should generate
 * migrations with drizzle-kit from `mediaPgTable` / `mediaUploadSessionsPgTable` /
 * `mediaUploadPartsPgTable`. Tables land in the connection's current `search_path` schema.
 */
export async function createMediaPgTables(db: DrizzlePgDatabase): Promise<void> {
  for (const statement of MEDIA_PG_DDL) {
    await db.execute(sql.raw(statement));
  }
}
