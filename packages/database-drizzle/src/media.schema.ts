import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { mediaColumns } from './media-columns';

/**
 * Drizzle (sqlite) media table. `order` maps to the `position` column. JSON columns
 * use text(mode:'json'). Postgres/MySQL variants follow the same shape via their
 * respective drizzle cores.
 */
export const mediaTable = sqliteTable(
  'media',
  {
    ...mediaColumns(),
    /** Tenancy only: read and written once the store's `enableTenancy()` ran. */
    tenantId: text('tenant_id'),
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
    tenantIdx: index('idx_media_tenant').on(
      table.tenantId,
      table.ownerType,
      table.ownerId,
      table.collection,
    ),
  }),
);
