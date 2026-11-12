export interface MediaConversion {
  path: string;
  disk: string;
}

/** A stored file associated with an owning entity (spatie media-library style). */
export interface MediaRecord {
  id: string;
  ownerType: string;
  ownerId: string;
  collection: string;
  /** Logical display name (defaults to the file name without extension). */
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  disk: string;
  path: string;
  order: number;
  customProperties: Record<string, unknown>;
  /** Generated variants keyed by conversion name (e.g. `thumb`). */
  conversions: Record<string, MediaConversion>;
  createdAt: Date;
  updatedAt: Date;
  /**
   * The tenant the record belongs to (`null` = none). Set only while tenancy is on; stores leave
   * it `undefined` otherwise and never read or write their tenant column.
   */
  tenantId?: string | null;
}
