import type { MediaRecord } from '@dudousxd/nestjs-media-core';
import { EntitySchema } from '@mikro-orm/core';
import { MediaRepository } from './media.repository';

/** MikroORM schema for media records, in `schema` when given. `order` maps to `position`. */
function buildMediaEntity(schema: string | undefined): EntitySchema<MediaRecord> {
  // One entity name per schema, so an app can register several side by side.
  const name = schema === undefined ? 'Media' : `Media_${schema}`;
  const target = { [name]: class {} }[name] as unknown as { new (): MediaRecord };
  return new EntitySchema<MediaRecord>({
    class: target,
    tableName: 'media',
    ...(schema !== undefined ? { schema } : {}),
    repository: () => MediaRepository,
    properties: {
      id: { type: 'string', primary: true },
      ownerType: { type: 'string' },
      ownerId: { type: 'string' },
      collection: { type: 'string' },
      name: { type: 'string' },
      fileName: { type: 'string' },
      mimeType: { type: 'string' },
      size: { type: 'integer' },
      disk: { type: 'string' },
      path: { type: 'string' },
      order: { type: 'integer', fieldName: 'position' },
      customProperties: { type: 'json' },
      conversions: { type: 'json' },
      createdAt: { type: 'datetime' },
      updatedAt: { type: 'datetime' },
      // Tenancy only. Lazy, so it is never selected unless the store asks for it (once tenancy is
      // on); a table without the column keeps working.
      tenantId: { type: 'string', fieldName: 'tenant_id', nullable: true, lazy: true },
    },
    indexes: [
      { name: 'idx_media_collection', properties: ['collection'] },
      { name: 'idx_media_disk', properties: ['disk'] },
      { name: 'idx_media_created_at', properties: ['createdAt'] },
      { name: 'idx_media_collection_created_at_id', properties: ['collection', 'createdAt', 'id'] },
      {
        name: 'idx_media_tenant',
        properties: ['tenantId', 'ownerType', 'ownerId', 'collection'],
      },
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
 * one your store uses (`entities: [mediaEntity({ schema: 'media' })]`) and pass the same `schema` to
 * `MikroOrmMediaStore`. Same `schema`, same instance.
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
