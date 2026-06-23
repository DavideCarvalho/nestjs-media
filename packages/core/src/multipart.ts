import type { MultipartUploadDriver, StorageDriver } from './types';

export function isMultipartCapable(
  driver: StorageDriver,
): driver is StorageDriver & MultipartUploadDriver {
  return (
    driver.capabilities.multipart === true &&
    typeof (driver as Partial<MultipartUploadDriver>).createMultipartUpload === 'function'
  );
}
