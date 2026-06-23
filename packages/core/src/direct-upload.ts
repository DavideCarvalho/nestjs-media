import { publishMedia } from './diagnostics';
import { UnsupportedOperationError } from './errors';
import { isMultipartCapable } from './multipart';
import type { StorageManager } from './storage-manager';
import type { MultipartPart } from './types';

export interface DirectUploadManagerOptions {
  storage: StorageManager;
  /** default 8 MiB */
  defaultPartSize?: number;
  /** default 3600 */
  presignExpirySeconds?: number;
  /** Emit upload.* diagnostics events (default true). */
  emitDiagnostics?: boolean;
}

export interface CreateDirectUploadInput {
  disk?: string;
  key: string;
  contentType?: string;
  size?: number;
  partSize?: number;
}

export interface DirectUploadCreated {
  uploadId: string;
  key: string;
  disk: string;
  partSize: number;
  parts: { partNumber: number; url: string }[];
}

const DEFAULT_PART_SIZE = 8 * 1024 * 1024; // 8 MiB
const DEFAULT_EXPIRY_SECONDS = 3600;

export class DirectUploadManager {
  private readonly storage: StorageManager;
  private readonly defaultPartSize: number;
  private readonly presignExpirySeconds: number;
  private readonly emitDiagnostics: boolean;

  constructor(options: DirectUploadManagerOptions) {
    this.storage = options.storage;
    this.defaultPartSize = options.defaultPartSize ?? DEFAULT_PART_SIZE;
    this.presignExpirySeconds = options.presignExpirySeconds ?? DEFAULT_EXPIRY_SECONDS;
    this.emitDiagnostics = options.emitDiagnostics ?? true;
  }

  async createUpload(input: CreateDirectUploadInput): Promise<DirectUploadCreated> {
    const diskName = input.disk ?? this.storage.defaultDisk;
    const driver = this.storage.disk(diskName);

    if (!isMultipartCapable(driver)) {
      throw new UnsupportedOperationError(diskName, 'direct upload');
    }

    const putOptions = input.contentType ? { contentType: input.contentType } : undefined;
    const { uploadId } = await driver.createMultipartUpload(input.key, putOptions);

    const partSize = input.partSize ?? this.defaultPartSize;
    const partCount = input.size !== undefined ? Math.ceil(input.size / partSize) : 1;

    const parts: { partNumber: number; url: string }[] = [];
    for (let n = 1; n <= partCount; n++) {
      const url = await driver.presignUploadPart(input.key, uploadId, n, this.presignExpirySeconds);
      parts.push({ partNumber: n, url });
    }

    if (this.emitDiagnostics) {
      publishMedia('upload.start', {
        id: uploadId,
        disk: diskName,
        key: input.key,
        size: input.size,
        contentType: input.contentType,
      });
    }

    return { uploadId, key: input.key, disk: diskName, partSize, parts };
  }

  async presignPart(input: {
    disk?: string;
    key: string;
    uploadId: string;
    partNumber: number;
  }): Promise<{ url: string }> {
    const diskName = input.disk ?? this.storage.defaultDisk;
    const driver = this.storage.disk(diskName);

    if (!isMultipartCapable(driver)) {
      throw new UnsupportedOperationError(diskName, 'direct upload');
    }

    const url = await driver.presignUploadPart(
      input.key,
      input.uploadId,
      input.partNumber,
      this.presignExpirySeconds,
    );

    return { url };
  }

  async completeUpload(input: {
    disk?: string;
    key: string;
    uploadId: string;
    parts: MultipartPart[];
  }): Promise<{ key: string; disk: string }> {
    const diskName = input.disk ?? this.storage.defaultDisk;
    const driver = this.storage.disk(diskName);

    if (!isMultipartCapable(driver)) {
      throw new UnsupportedOperationError(diskName, 'direct upload');
    }

    await driver.completeMultipartUpload(input.key, input.uploadId, input.parts);

    if (this.emitDiagnostics) {
      publishMedia('upload.complete', {
        id: input.uploadId,
        disk: diskName,
        key: input.key,
        size: 0,
      });
    }

    return { key: input.key, disk: diskName };
  }

  async abortUpload(input: {
    disk?: string;
    key: string;
    uploadId: string;
  }): Promise<void> {
    const diskName = input.disk ?? this.storage.defaultDisk;
    const driver = this.storage.disk(diskName);

    if (!isMultipartCapable(driver)) {
      throw new UnsupportedOperationError(diskName, 'direct upload');
    }

    await driver.abortMultipartUpload(input.key, input.uploadId);

    if (this.emitDiagnostics) {
      publishMedia('upload.abort', { id: input.uploadId });
    }
  }
}
