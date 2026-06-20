import { describe, expect, it } from 'vitest';
import { UnsupportedOperationError } from './errors';
import type { DriverCapabilities } from './types';
import { resolveUploadMode } from './upload-mode';

const s3Caps: DriverCapabilities = { presign: true, multipart: true, publicUrls: true };
const localCaps: DriverCapabilities = { presign: false, multipart: false, publicUrls: false };

describe('resolveUploadMode', () => {
  it('auto picks direct for a presign/multipart-capable driver', () => {
    expect(resolveUploadMode({}, s3Caps)).toBe('direct');
  });

  it('auto falls back to proxy for an incapable driver', () => {
    expect(resolveUploadMode({}, localCaps)).toBe('proxy');
  });

  it('per-call overrides per-disk overrides global', () => {
    expect(resolveUploadMode({ global: 'direct', perDisk: 'proxy' }, s3Caps)).toBe('proxy');
    expect(
      resolveUploadMode({ global: 'direct', perDisk: 'proxy', perCall: 'direct' }, s3Caps),
    ).toBe('direct');
    expect(resolveUploadMode({ global: 'proxy' }, s3Caps)).toBe('proxy');
  });

  it('forced proxy is always allowed, even on a capable driver', () => {
    expect(resolveUploadMode({ perCall: 'proxy' }, s3Caps)).toBe('proxy');
  });

  it('forced direct throws on an incapable driver', () => {
    expect(() => resolveUploadMode({ perCall: 'direct' }, localCaps, 'local')).toThrow(
      UnsupportedOperationError,
    );
  });

  it('forced direct works on a capable driver', () => {
    expect(resolveUploadMode({ perDisk: 'direct' }, s3Caps)).toBe('direct');
  });
});
