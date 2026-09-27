import type { MediaConversion } from '@dudousxd/nestjs-media-core';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle (Postgres) media table — the same logical shape as the sqlite `mediaTable`.
 * `order` maps to the `position` column; JSON columns are `jsonb`; timestamps are `timestamptz`.
 * Generate migrations for it with drizzle-kit (or use `createMediaPgTables` in tests/dev).
 */
export const mediaPgTable = pgTable(
  'media',
  {
    id: text('id').primaryKey(),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    collection: text('collection').notNull(),
    name: text('name').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    disk: text('disk').notNull(),
    path: text('path').notNull(),
    order: integer('position').notNull(),
    customProperties: jsonb('custom_properties').$type<Record<string, unknown>>().notNull(),
    conversions: jsonb('conversions').$type<Record<string, MediaConversion>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    index('idx_media_owner').on(table.ownerType, table.ownerId, table.collection),
    index('idx_media_collection').on(table.collection),
    index('idx_media_disk').on(table.disk),
    index('idx_media_created_at').on(table.createdAt),
    index('idx_media_collection_created_at').on(table.collection, table.createdAt, table.id),
  ],
);

/** Resumable-upload sessions (the Postgres `UploadSessionStore`). */
export const mediaUploadSessionsPgTable = pgTable('media_upload_sessions', {
  id: text('id').primaryKey(),
  disk: text('disk').notNull(),
  key: text('key').notNull(),
  contentType: text('content_type'),
  size: bigint('size', { mode: 'number' }),
  offset: bigint('offset', { mode: 'number' }).notNull().default(0),
  parts: integer('parts').notNull().default(0),
  multipartUploadId: text('multipart_upload_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

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
