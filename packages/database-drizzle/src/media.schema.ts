import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Drizzle (sqlite) media table. `order` maps to the `position` column. JSON columns
 * use text(mode:'json'). Postgres/MySQL variants follow the same shape via their
 * respective drizzle cores.
 */
export const mediaTable = sqliteTable(
  'media',
  {
    id: text('id').primaryKey(),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    collection: text('collection').notNull(),
    name: text('name').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    disk: text('disk').notNull(),
    path: text('path').notNull(),
    order: integer('position').notNull(),
    customProperties: text('custom_properties', { mode: 'json' }).notNull(),
    conversions: text('conversions', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    ownerIdx: index('idx_media_owner').on(table.ownerType, table.ownerId, table.collection),
    collectionIdx: index('idx_media_collection').on(table.collection),
    diskIdx: index('idx_media_disk').on(table.disk),
    createdAtIdx: index('idx_media_created_at').on(table.createdAt),
    collectionCreatedAtIdx: index('idx_media_collection_created_at').on(
      table.collection,
      table.createdAt,
      table.id,
    ),
  }),
);
