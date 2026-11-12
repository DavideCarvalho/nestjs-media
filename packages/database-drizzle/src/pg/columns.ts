import type { MediaConversion } from '@dudousxd/nestjs-media-core';
import { bigint, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

/** The `media` columns but `tenant_id` (fresh builders per call: one set per table). */
export function mediaPgColumns() {
  return {
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
  };
}

/** The `media_upload_sessions` columns but `tenant_id`. */
export function uploadSessionPgColumns() {
  return {
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
  };
}
