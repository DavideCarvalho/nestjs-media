import { describe, expect, it } from 'vitest';
import { UnknownDiskError } from './errors';
import { StorageManager } from './storage-manager';
import type { StorageDriver } from './types';

const fakeDriver = (): StorageDriver =>
  ({ capabilities: { presign: false, multipart: false, publicUrls: false } }) as StorageDriver;

describe('StorageManager', () => {
  it('returns the default disk when no name is given', () => {
    const def = fakeDriver();
    const mgr = new StorageManager({ default: 'local', disks: { local: def, s3: fakeDriver() } });
    expect(mgr.disk()).toBe(def);
    expect(mgr.defaultDisk).toBe('local');
  });

  it('returns a named disk', () => {
    const s3 = fakeDriver();
    const mgr = new StorageManager({ default: 'local', disks: { local: fakeDriver(), s3 } });
    expect(mgr.disk('s3')).toBe(s3);
  });

  it('throws UnknownDiskError for an unregistered disk', () => {
    const mgr = new StorageManager({ default: 'local', disks: { local: fakeDriver() } });
    expect(() => mgr.disk('nope')).toThrow(UnknownDiskError);
  });

  it('throws if the default disk is not registered', () => {
    expect(() => new StorageManager({ default: 'ghost', disks: { local: fakeDriver() } })).toThrow(
      UnknownDiskError,
    );
  });
});

// diskNames only reads the keys of the disks record; a bare object is a sufficient
// stand-in for a StorageDriver here (no method on it is called).
const driver = {} as unknown as StorageDriver;

describe('StorageManager.diskNames', () => {
  it('returns the configured disk names', () => {
    const manager = new StorageManager({ default: 'a', disks: { a: driver, b: driver } });
    expect(manager.diskNames().sort()).toEqual(['a', 'b']);
  });
});
