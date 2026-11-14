// The JSON API contract for the /media console. Owned by the client entry so that both the
// server (which produces these shapes) and any host app (which may want the types) import them
// from `@dudousxd/nestjs-media-dashboard/client`. Pure types — no runtime.
//
// Lists follow the Aviary list API: rows under `data`, a cursor-paged list adds `meta`
// (`CursorPageMeta`), filters go in `filter[field]=value`, cursor paging in `after` + `first`.

/** The `meta` of a cursor-paged list. A cursor is `null` when there is no page that way. */
export interface CursorPageMeta {
  nextCursor: string | null;
  prevCursor: string | null;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * What a disk can do, computed by the server from the `@nestjs/storage` disk and its multipart
 * side-car (`MediaDiskCapabilities` in `-core`).
 */
export interface DiskCapabilities {
  /** `signedUrl()` works (S3, or a local disk with `signedUrls`). */
  presign: boolean;
  /** A multipart side-car is configured for the disk. */
  multipart: boolean;
  /** The disk has a `publicUrl`. */
  publicUrls: boolean;
  list: boolean;
  /**
   * Can the disk serve a byte range (a ranged `object/raw`)? Every `@nestjs/storage` disk can, so
   * current servers always send `true`. Optional because this is a WIRE shape: an older server may
   * not emit it, and `undefined` means "don't count on it", not `false`.
   */
  ranged?: boolean;
}

export interface DiskInfo {
  name: string;
  default: boolean;
  capabilities: DiskCapabilities;
}

/** `GET disks`: every registered disk (a small, unpaged list). */
export interface DiskListResponse {
  data: DiskInfo[];
}

/** A folder prefix (no trailing slash) inside a disk. */
export interface ObjectFolder {
  name: string;
  prefix: string;
}

/** A concrete object inside a disk. */
export interface ObjectEntry {
  key: string;
  name: string;
  sizeBytes: number | null;
  lastModified: string | null;
}

/**
 * `GET disks/:disk/objects`: one folder level, cursor-paged. `data` holds the level's files; the
 * page's folders ride next to it as `folders` (side data of the same page, not a second list). Pass
 * `meta.nextCursor` back as `after` for the next page.
 */
export interface ObjectListResponse {
  data: ObjectEntry[];
  folders: ObjectFolder[];
  meta: CursorPageMeta;
}

export interface ObjectDetailResponse {
  key: string;
  size: number;
  contentType?: string;
  lastModified?: string;
  url: string;
}

/** A row's tenant, as the console shows it. */
export interface ConsoleTenant {
  id: string;
  label: string;
}

export interface UploadInfo {
  id: string;
  disk: string;
  key: string;
  offset: number;
  size: number | null;
  percent: number | null;
  parts: number;
  multipart: boolean;
  createdAt?: string;
  /**
   * The row's tenant, with tenancy on: its id and display label (the app's `tenancy.label`, else
   * the id). `null` for a row with no tenant; absent with tenancy off.
   */
  tenant?: ConsoleTenant | null;
}

/** `GET uploads`: the upload sessions in progress (unpaged). */
export interface UploadListResponse {
  data: UploadInfo[];
}

export interface UploadPart {
  partNumber: number;
  etag: string;
}

export interface UploadDetailResponse {
  upload: UploadInfo;
  parts: UploadPart[];
}

export interface CollectionInfo {
  key: string;
  count: number;
  sumSize: number;
}

/** `GET library/collections`: every collection with its record count and total bytes (unpaged). */
export interface CollectionsResponse {
  data: CollectionInfo[];
}

export interface LibraryRecord {
  id: string;
  ownerType: string;
  ownerId: string;
  collection: string;
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  disk: string;
  path: string;
  createdAt: string;
  /**
   * The row's tenant, with tenancy on: its id and display label (the app's `tenancy.label`, else
   * the id). `null` for a row with no tenant; absent with tenancy off.
   */
  tenant?: ConsoleTenant | null;
}

/** `GET library`: media records, oldest first, cursor-paged. Pass `meta.nextCursor` back as `after`. */
export interface LibraryListResponse {
  data: LibraryRecord[];
  meta: CursorPageMeta;
}

export interface LibraryVariant {
  name: string;
  url: string;
  /** Where the variant actually lives, so the UI can reach the console's own object routes for it
   *  (download, proxied read) — `url` alone is opaque, and under `objectUrls: 'auto'` points at the
   *  object store rather than at this server. Empty when the record names a disk that is no longer
   *  registered, which is the same case `url` reports as `''`. */
  disk: string;
  path: string;
}

export interface LibraryDetailResponse {
  record: LibraryRecord;
  variants: LibraryVariant[];
}

export interface Topology {
  hasStore: boolean;
  hasUploads: boolean;
  disks: number;
  actions: boolean;
}

/** One label/value row of an {@link ObjectInsight}. Rendered verbatim as text — no markup. */
export interface ObjectInsightFact {
  label: string;
  value: string;
}

/** A link out to the host's own screens, rendered as an anchor. */
export interface ObjectInsightLink {
  label: string;
  href: string;
}

/**
 * Host-supplied context about one disk object, rendered in the console preview.
 *
 * The console can describe a file only as storage sees it (key, size, type). This is what the HOST
 * knows about it — which knowledge base indexed it, which work order it belongs to — handed over as
 * data, because the console ships as a prebuilt bundle a host cannot inject components into.
 */
export interface ObjectInsight {
  /** Section heading, e.g. `Knowledge base`. */
  title: string;
  facts?: ObjectInsightFact[];
  links?: ObjectInsightLink[];
  /** One line of prose under the facts — a caveat, a status explanation. */
  note?: string;
}

/** What `GET disks/:disk/object/insights` returns. Empty when the host registered no providers. */
export interface ObjectInsightsResponse {
  insights: ObjectInsight[];
}
