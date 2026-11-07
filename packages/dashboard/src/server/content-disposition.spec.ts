import { describe, expect, it } from 'vitest';
import { downloadFilename } from './content-disposition.js';

describe('downloadFilename', () => {
  it('takes the last segment of a key', () => {
    expect(downloadFilename('reports/2026/q1.csv')).toBe('q1.csv');
    expect(downloadFilename('q1.csv')).toBe('q1.csv');
  });

  it('falls back for a key that names no file', () => {
    // A folder marker (the zero-byte key `createFolder` writes) has no last segment.
    expect(downloadFilename('reports/2026/')).toBe('download');
    expect(downloadFilename('')).toBe('download');
    expect(downloadFilename('   ')).toBe('download');
  });
});
