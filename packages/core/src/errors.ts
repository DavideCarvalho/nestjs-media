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

export class MimeNotAllowedError extends Error {
  readonly code = 'MEDIA_MIME_NOT_ALLOWED';
  constructor(collection: string, mimeType: string) {
    super(`MIME type "${mimeType}" is not allowed in collection "${collection}"`);
    this.name = 'MimeNotAllowedError';
  }
}

export class MediaNotFoundError extends Error {
  readonly code = 'MEDIA_RECORD_NOT_FOUND';
  constructor(id: string) {
    super(`Media record not found: ${id}`);
    this.name = 'MediaNotFoundError';
  }
}

export class ConversionNotDefinedError extends Error {
  readonly code = 'MEDIA_CONVERSION_NOT_DEFINED';
  constructor(collection: string, conversion: string) {
    super(`Conversion "${conversion}" is not defined for collection "${collection}"`);
    this.name = 'ConversionNotDefinedError';
  }
}

export class ImageProcessorMissingError extends Error {
  readonly code = 'MEDIA_IMAGE_PROCESSOR_MISSING';
  constructor() {
    super('No ImageProcessor was configured; conversions are unavailable');
    this.name = 'ImageProcessorMissingError';
  }
}

export class UploadSessionNotFoundError extends Error {
  readonly code = 'MEDIA_UPLOAD_SESSION_NOT_FOUND';
  constructor(id: string) {
    super(`Upload session not found: ${id}`);
    this.name = 'UploadSessionNotFoundError';
  }
}

export class UploadOffsetConflictError extends Error {
  readonly code = 'MEDIA_UPLOAD_OFFSET_CONFLICT';
  constructor(
    readonly expected: number,
    readonly received: number,
  ) {
    super(`Upload offset conflict: expected ${expected}, received ${received}`);
    this.name = 'UploadOffsetConflictError';
  }
}

export class InvalidPartNumberError extends Error {
  constructor(partNumber: number) {
    super(`Invalid multipart part number: ${partNumber} (must be an integer in 1..10000)`);
    this.name = 'InvalidPartNumberError';
  }
}
