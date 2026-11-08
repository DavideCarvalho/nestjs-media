import { describe, expect, it } from 'vitest';
import { InvalidMediaKeyError, UnsupportedOperationError } from './index';

describe('errors', () => {
  it('UnsupportedOperationError names disk + op', () => {
    const err = new UnsupportedOperationError('local', 'direct upload');
    expect(err.message).toContain('local');
    expect(err.message).toContain('direct upload');
    expect(err.code).toBe('MEDIA_UNSUPPORTED_OP');
  });

  it('InvalidMediaKeyError carries status 400', () => {
    const err = new InvalidMediaKeyError('empty');
    expect(err.status).toBe(400);
    expect(err.code).toBe('MEDIA_INVALID_KEY');
  });
});
