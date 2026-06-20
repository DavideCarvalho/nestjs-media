export class FileNotFoundError extends Error {
  readonly code = 'MEDIA_FILE_NOT_FOUND';
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

export class UnknownDiskError extends Error {
  readonly code = 'MEDIA_UNKNOWN_DISK';
  constructor(name: string) {
    super(`Unknown disk: ${name}`);
    this.name = 'UnknownDiskError';
  }
}

export class UnsupportedOperationError extends Error {
  readonly code = 'MEDIA_UNSUPPORTED_OP';
  constructor(driver: string, op: string) {
    super(`Driver "${driver}" does not support operation "${op}"`);
    this.name = 'UnsupportedOperationError';
  }
}
