import type { MediaRecord } from '@dudousxd/nestjs-media-core';
import { EntitySchema } from '@mikro-orm/core';

/** MikroORM schema for media records. `order` maps to the `position` column. */
export const MediaEntity = new EntitySchema<MediaRecord>({
  class: class Media {} as { new (): MediaRecord },
  tableName: 'media',
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
  },
});
