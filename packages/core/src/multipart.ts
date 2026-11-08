import { UnsupportedOperationError } from './errors';
import type { MultipartUploadDriver } from './types';

/** Multipart side-cars by disk name. */
export type MultipartDrivers = Readonly<Record<string, MultipartUploadDriver>>;

/** The side-car configured for `disk`, if any. */
export function multipartFor(
  drivers: MultipartDrivers | undefined,
  disk: string,
): MultipartUploadDriver | undefined {
  return drivers && Object.hasOwn(drivers, disk) ? drivers[disk] : undefined;
}

/** The side-car configured for `disk`, or an `UnsupportedOperationError` naming `operation`. */
export function requireMultipart(
  drivers: MultipartDrivers | undefined,
  disk: string,
  operation: string,
): MultipartUploadDriver {
  const driver = multipartFor(drivers, disk);
  if (!driver) throw new UnsupportedOperationError(disk, operation);
  return driver;
}
