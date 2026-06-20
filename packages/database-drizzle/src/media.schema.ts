import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Drizzle (sqlite) media table. `order` maps to the `position` column. JSON columns
 * use text(mode:'json'). Postgres/MySQL variants follow the same shape via their
 * respective drizzle cores.
 */
export const mediaTable = sqliteTable('media', {
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
});
