import { describe, expect, it } from 'vitest';
import { FileNotFoundError, UnknownDiskError, UnsupportedOperationError } from './index';

describe('errors', () => {
  it('FileNotFoundError carries path + stable code', () => {
    const err = new FileNotFoundError('a/b.png');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('MEDIA_FILE_NOT_FOUND');
    expect(err.message).toContain('a/b.png');
  });

  it('UnknownDiskError names the disk', () => {
    expect(new UnknownDiskError('s3').message).toContain('s3');
    expect(new UnknownDiskError('s3').code).toBe('MEDIA_UNKNOWN_DISK');
  });

  it('UnsupportedOperationError names driver + op', () => {
    const err = new UnsupportedOperationError('local', 'temporaryUrl');
    expect(err.message).toContain('local');
    expect(err.message).toContain('temporaryUrl');
    expect(err.code).toBe('MEDIA_UNSUPPORTED_OP');
  });
});
