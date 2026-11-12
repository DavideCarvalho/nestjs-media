import { index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { mediaPgColumns, uploadSessionPgColumns } from './columns';

/**
 * Drizzle (Postgres) media table — the same logical shape as the sqlite `mediaTable`.
 * `order` maps to the `position` column; JSON columns are `jsonb`; timestamps are `timestamptz`.
 * Generate migrations for it with drizzle-kit (or use `createMediaPgTables` in tests/dev).
 */
export const mediaPgTable = pgTable(
  'media',
  {
    ...mediaPgColumns(),
    /** Tenancy only: read and written once the store's `enableTenancy()` ran. */
    tenantId: text('tenant_id'),
  },
  (table) => [
    index('idx_media_owner').on(table.ownerType, table.ownerId, table.collection),
    index('idx_media_collection').on(table.collection),
    index('idx_media_disk').on(table.disk),
    index('idx_media_created_at').on(table.createdAt),
    index('idx_media_collection_created_at').on(table.collection, table.createdAt, table.id),
    index('idx_media_tenant').on(table.tenantId, table.ownerType, table.ownerId, table.collection),
  ],
);

/** Resumable-upload sessions (the Postgres `UploadSessionStore`). */
export const mediaUploadSessionsPgTable = pgTable(
  'media_upload_sessions',
  {
    ...uploadSessionPgColumns(),
    /** Tenancy only: read and written once the store's `enableTenancy()` ran. */
    tenantId: text('tenant_id'),
  },
  (table) => [index('idx_media_upload_sessions_tenant').on(table.tenantId)],
);

/** One row per uploaded multipart part; `addPart` upserts on `(session_id, part_number)`. */
export const mediaUploadPartsPgTable = pgTable(
  'media_upload_parts',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => mediaUploadSessionsPgTable.id, { onDelete: 'cascade' }),
    partNumber: integer('part_number').notNull(),
    etag: text('etag').notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.partNumber] })],
);
