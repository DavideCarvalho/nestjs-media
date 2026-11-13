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
function buildMediaEntity(schema: string | undefined): EntitySchema<MediaRecord> {
  return new EntitySchema<MediaRecord>({
    name: schema === undefined ? 'media' : `${schema}.media`,
    tableName: 'media',
    // Postgres qualifies by `schema`, MySQL by `database` (its schemas are databases): each driver
    // reads the one it uses.
    ...(schema !== undefined ? { schema, database: schema } : {}),
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
      // Tenancy only. Never selected, inserted or updated by the entity itself: the store reads and
      // writes it explicitly once tenancy is on, so a table without the column keeps working.
      tenantId: {
        type: String,
        name: 'tenant_id',
        nullable: true,
        select: false,
        insert: false,
        update: false,
      },
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
      { name: 'idx_media_tenant', columns: ['tenantId', 'ownerType', 'ownerId', 'collection'] },
    ],
  });
}

/** The unqualified media entity: the `media` table of the connection's current schema. */
export const MediaEntity: EntitySchema<MediaRecord> = buildMediaEntity(undefined);

const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const bySchema = new Map<string, EntitySchema<MediaRecord>>();

/** Validates a `schema` option: a letter or `_`, then letters, digits, `_` or `$`, ≤ 63 chars. */
export function assertSchemaName(schema: string): void {
  if (typeof schema !== 'string' || !SCHEMA_NAME.test(schema) || schema.length > 63) {
    throw new TypeError(
      `[nestjs-media] \`schema\` must match /^[A-Za-z_][A-Za-z0-9_$]*$/ and be at most 63 characters, got ${JSON.stringify(schema)}`,
    );
  }
}

/**
 * The media entity, in `schema` when given: a Postgres schema, or on MySQL a database. Register the
 * one your store uses in the DataSource (`entities: [mediaEntity({ schema: 'media' })]`) and pass
 * the same `schema` to `TypeOrmMediaStore`. Same `schema`, same instance.
 */
export function mediaEntity(
  options: { schema?: string | undefined } = {},
): EntitySchema<MediaRecord> {
  if (options.schema === undefined) return MediaEntity;
  assertSchemaName(options.schema);
  let entity = bySchema.get(options.schema);
  if (!entity) {
    entity = buildMediaEntity(options.schema);
    bySchema.set(options.schema, entity);
  }
  return entity;
}
