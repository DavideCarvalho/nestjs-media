import { index, integer, pgSchema, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { assertSchemaName } from '../schema-name';
import { mediaPgColumns, uploadSessionPgColumns } from './columns';

/** `pgTable`, or `pgSchema(schema).table` when the tables live in their own schema. */
function tableIn(schema: string | undefined): typeof pgTable {
  if (schema === undefined) return pgTable;
  assertSchemaName(schema);
  if (schema === 'public') {
    throw new TypeError(
      "[nestjs-media] `schema: 'public'` is Postgres' default schema: leave `schema` unset to use it.",
    );
  }
  return pgSchema(schema).table as unknown as typeof pgTable;
}

/**
 * The Postgres media tables, in `schema` when given (every statement names it; `search_path` is
 * never used), else unqualified. The stores build theirs from their `schema` option; the exported
 * `mediaPgTable` / `mediaUploadSessionsPgTable` / `mediaUploadPartsPgTable` are the unqualified set.
 * For drizzle-kit migrations of a schema, export `mediaPgTables('media')`'s tables from your schema.
 */
export function mediaPgTables(schema?: string) {
  const table = tableIn(schema);
  const media = table(
    'media',
    {
      ...mediaPgColumns(),
      /** Tenancy only: read and written once the store's `enableTenancy()` ran. */
      tenantId: text('tenant_id'),
    },
    (t) => [
      index('idx_media_owner').on(t.ownerType, t.ownerId, t.collection),
      index('idx_media_collection').on(t.collection),
      index('idx_media_disk').on(t.disk),
      index('idx_media_created_at').on(t.createdAt),
      index('idx_media_collection_created_at').on(t.collection, t.createdAt, t.id),
      index('idx_media_tenant').on(t.tenantId, t.ownerType, t.ownerId, t.collection),
    ],
  );
  const uploadSessions = table(
    'media_upload_sessions',
    {
      ...uploadSessionPgColumns(),
      /** Tenancy only: read and written once the store's `enableTenancy()` ran. */
      tenantId: text('tenant_id'),
    },
    (t) => [index('idx_media_upload_sessions_tenant').on(t.tenantId)],
  );
  const uploadParts = table(
    'media_upload_parts',
    {
      sessionId: text('session_id')
        .notNull()
        .references(() => uploadSessions.id, { onDelete: 'cascade' }),
      partNumber: integer('part_number').notNull(),
      etag: text('etag').notNull(),
    },
    (t) => [primaryKey({ columns: [t.sessionId, t.partNumber] })],
  );
  return {
    media,
    uploadSessions,
    uploadParts,
    /**
     * Internal: the tables without `tenant_id`. The stores insert through them while tenancy is
     * off, because Drizzle lists every column of a table in an `INSERT`.
     */
    mediaWithoutTenant: table('media', mediaPgColumns()),
    uploadSessionsWithoutTenant: table('media_upload_sessions', uploadSessionPgColumns()),
  };
}

/** The table set the stores use. */
export type MediaPgTables = ReturnType<typeof mediaPgTables>;

const unqualified = mediaPgTables();

/**
 * Drizzle (Postgres) media table — the same logical shape as the sqlite `mediaTable`.
 * `order` maps to the `position` column; JSON columns are `jsonb`; timestamps are `timestamptz`.
 * Generate migrations for it with drizzle-kit (or use `createMediaPgTables` in tests/dev).
 */
export const mediaPgTable: MediaPgTables['media'] = unqualified.media;

/** Resumable-upload sessions (the Postgres `UploadSessionStore`). */
export const mediaUploadSessionsPgTable: MediaPgTables['uploadSessions'] =
  unqualified.uploadSessions;

/** One row per uploaded multipart part; `addPart` upserts on `(session_id, part_number)`. */
export const mediaUploadPartsPgTable: MediaPgTables['uploadParts'] = unqualified.uploadParts;
