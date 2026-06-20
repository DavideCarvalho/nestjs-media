import { UnknownDiskError } from './errors';
import type { StorageDriver } from './types';

export interface StorageManagerOptions {
  default: string;
  disks: Record<string, StorageDriver>;
}

export class StorageManager {
  readonly defaultDisk: string;
  private readonly disks: Record<string, StorageDriver>;

  constructor(options: StorageManagerOptions) {
    this.disks = options.disks;
    this.defaultDisk = options.default;
    if (!this.disks[this.defaultDisk]) throw new UnknownDiskError(this.defaultDisk);
  }

  disk(name?: string): StorageDriver {
    const key = name ?? this.defaultDisk;
    const driver = this.disks[key];
    if (!driver) throw new UnknownDiskError(key);
    return driver;
  }
}
