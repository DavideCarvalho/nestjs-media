import { describe, expect, it } from 'vitest';
import { isMultipartCapable } from './multipart';
import type { MultipartPart, StorageDriver } from './types';

function makeDriver(multipart: boolean, hasMethod: boolean): StorageDriver {
  const base = {
    capabilities: {
      presign: true,
      multipart,
      publicUrls: false,
      list: true,
    },
    put: async () => {},
    get: async () => Buffer.alloc(0),
    stream: async () => {
      throw new Error();
    },
    exists: async () => false,
    delete: async () => {},
    copy: async () => {},
    move: async () => {},
    size: async () => 0,
    url: async () => '',
    temporaryUrl: async () => '',
    list: async () => ({ folders: [], files: [] }),
  } as StorageDriver;

  if (hasMethod) {
    (base as StorageDriver & { createMultipartUpload: unknown }).createMultipartUpload = async (
      _path: string,
    ) => ({ uploadId: 'test' });
  }

  return base;
}

describe('isMultipartCapable', () => {
  it('returns true when capabilities.multipart is true and createMultipartUpload is a function', () => {
    const driver = makeDriver(true, true);
    expect(isMultipartCapable(driver)).toBe(true);
  });

  it('returns false when capabilities.multipart is false even if the method exists', () => {
    const driver = makeDriver(false, true);
    expect(isMultipartCapable(driver)).toBe(false);
  });

  it('returns false when capabilities.multipart is true but createMultipartUpload is missing', () => {
    const driver = makeDriver(true, false);
    expect(isMultipartCapable(driver)).toBe(false);
  });

  it('narrows type correctly — calling methods compiles without error', async () => {
    const driver = makeDriver(true, true);
    if (isMultipartCapable(driver)) {
      const result = await driver.createMultipartUpload('video.mp4');
      expect(result).toEqual({ uploadId: 'test' });
    }
  });
});
