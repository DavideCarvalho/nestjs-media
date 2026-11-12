import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** The `media` columns but `tenant_id` (fresh builders per call: one set per table). */
export function mediaColumns() {
  return {
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
  };
}

/**
 * Internal: the same `media` table without `tenant_id`. The store inserts through it while tenancy
 * is off, because Drizzle lists every column of a table in an `INSERT`. Not exported.
 */
export const mediaTableWithoutTenant = sqliteTable('media', mediaColumns());
