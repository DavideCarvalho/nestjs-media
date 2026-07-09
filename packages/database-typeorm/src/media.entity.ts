import type { MediaRecord } from '@dudousxd/nestjs-media-core';
import { EntitySchema } from 'typeorm';

// Timestamps are stored as ISO strings (varchar) so the schema is portable across
// every dialect — `datetime` (sqlite/mysql) and `timestamp` (postgres) have no shared
// literal, so we sidestep dialect-specific date types entirely.
const isoDate = {
  to: (value?: Date) => (value ? value.toISOString() : value),
  from: (value?: string) => (value ? new Date(value) : value),
};

/**
 * TypeORM schema for media records. Declared via EntitySchema (not decorators)
 * so the library carries no decorator-metadata build requirement. The `order`
 * property maps to the `position` column to avoid the reserved SQL keyword.
 */
export const MediaEntity = new EntitySchema<MediaRecord>({
  name: 'media',
  tableName: 'media',
  columns: {
    id: { type: String, primary: true },
    ownerType: { type: String },
    ownerId: { type: String },
    collection: { type: String },
    name: { type: String },
    fileName: { type: String },
    mimeType: { type: String },
    size: { type: 'int' },
    disk: { type: String },
    path: { type: String },
    order: { type: 'int', name: 'position' },
    customProperties: { type: 'simple-json' },
    conversions: { type: 'simple-json' },
    createdAt: { type: String, transformer: isoDate },
    updatedAt: { type: String, transformer: isoDate },
  },
  // Note: `ensureMediaSchema` only creates the table and adds missing columns
  // non-destructively — it does NOT add indexes to an already-existing table, so
  // pre-existing deployed tables need a manual `CREATE INDEX` migration for these.
  indices: [
    { name: 'idx_media_owner', columns: ['ownerType', 'ownerId', 'collection'] },
    { name: 'idx_media_collection', columns: ['collection'] },
    { name: 'idx_media_disk', columns: ['disk'] },
    { name: 'idx_media_created_at', columns: ['createdAt'] },
    { name: 'idx_media_list', columns: ['collection', 'createdAt', 'id'] },
  ],
});
