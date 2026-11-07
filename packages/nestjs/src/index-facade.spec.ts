import { describe, expect, it } from 'vitest';
// Compile/import check for the facade re-exports added to `index.ts` so
// consumers don't need to also depend on `@dudousxd/nestjs-media-core`
// directly for these commonly-needed types/values. If any of these are
// removed or renamed upstream in `-core`, this file fails to typecheck.
import {
  ConversionNotDefinedError,
  ImageProcessorMissingError,
  InvalidMediaKeyError,
  InvalidPartNumberError,
  MediaNotFoundError,
  MimeNotAllowedError,
  ResumableUploadManager,
  UnsupportedOperationError,
  UploadOffsetConflictError,
  UploadSessionNotFoundError,
  mediaDiagnosticKey,
  publishMedia,
} from './index';
import type {
  CreateUploadInput,
  FolderListing,
  MediaDiagnosticEvent,
  MultipartPart,
  UploadSession,
  UploadSessionListFilter,
  UploadSessionStore,
} from './index';

describe('facade re-exports from index.ts', () => {
  it('error classes are re-exported as values with stable `code`s', () => {
    expect(new InvalidMediaKeyError('empty').code).toBe('MEDIA_INVALID_KEY');
    expect(new UnsupportedOperationError('drv', 'op').code).toBe('MEDIA_UNSUPPORTED_OP');
    expect(new MimeNotAllowedError('c', 'm').code).toBe('MEDIA_MIME_NOT_ALLOWED');
    expect(new MediaNotFoundError('id').code).toBe('MEDIA_RECORD_NOT_FOUND');
    expect(new ConversionNotDefinedError('c', 'conv').code).toBe('MEDIA_CONVERSION_NOT_DEFINED');
    expect(new ImageProcessorMissingError().code).toBe('MEDIA_IMAGE_PROCESSOR_MISSING');
    expect(new UploadSessionNotFoundError('id').code).toBe('MEDIA_UPLOAD_SESSION_NOT_FOUND');
    expect(new UploadOffsetConflictError(1, 2).code).toBe('MEDIA_UPLOAD_OFFSET_CONFLICT');
    expect(new InvalidPartNumberError(0).code).toBe('MEDIA_INVALID_PART_NUMBER');
  });

  it('ResumableUploadManager is re-exported as the real class', () => {
    expect(typeof ResumableUploadManager).toBe('function');
  });

  it('mediaDiagnosticKey/publishMedia are re-exported as the real functions', () => {
    expect(mediaDiagnosticKey('upload.start')).toBe('media:upload.start');
    expect(typeof publishMedia).toBe('function');
  });

  it('storage-consumer + upload-session types are re-exported (type-only compile check)', () => {
    const listing: FolderListing = {
      folders: ['a/'],
      files: [{ key: 'b', size: 1, lastModified: new Date() }],
    };
    const multipartPart: MultipartPart = { partNumber: 1, etag: 'x' };
    const uploadSession: UploadSession = {
      id: 'u1',
      disk: 'local',
      key: 'k',
      contentType: undefined,
      size: undefined,
      offset: 0,
      parts: 0,
      createdAt: new Date(),
    };
    const createUploadInput: CreateUploadInput = { key: 'k', disk: 'local' };
    const listFilter: UploadSessionListFilter = {};
    const store: UploadSessionStore | null = null;
    const event: MediaDiagnosticEvent = 'upload.start';

    expect(listing.files).toHaveLength(1);
    expect(multipartPart.partNumber).toBe(1);
    expect(uploadSession.id).toBe('u1');
    expect(createUploadInput.key).toBe('k');
    expect(listFilter).toEqual({});
    expect(store).toBeNull();
    expect(event).toBe('upload.start');
  });
});
