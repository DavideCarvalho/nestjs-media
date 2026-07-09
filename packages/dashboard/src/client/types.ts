// The JSON API contract for the /media console. Owned by the client entry so that both the
// server (which produces these shapes) and any host app (which may want the types) import them
// from `@dudousxd/nestjs-media-dashboard/client`. Pure types — no runtime.

export interface DiskCapabilities {
  presign: boolean;
  multipart: boolean;
  publicUrls: boolean;
  list: boolean;
}

export interface DiskInfo {
  name: string;
  default: boolean;
  capabilities: DiskCapabilities;
}

export interface DiskListResponse {
  disks: DiskInfo[];
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

export interface ObjectListResponse {
  folders: ObjectFolder[];
  files: ObjectEntry[];
  cursor?: string;
}

export interface ObjectDetailResponse {
  key: string;
  size: number;
  contentType?: string;
  lastModified?: string;
  url: string;
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
}

export interface UploadListResponse {
  uploads: UploadInfo[];
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

export interface CollectionsResponse {
  collections: CollectionInfo[];
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
}

export interface LibraryListResponse {
  records: LibraryRecord[];
  cursor?: string;
}

export interface LibraryVariant {
  name: string;
  url: string;
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
