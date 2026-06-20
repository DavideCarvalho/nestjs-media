import { UnsupportedOperationError } from './errors';
import type { DriverCapabilities } from './types';

export type UploadMode = 'auto' | 'proxy' | 'direct';
export type ResolvedUploadMode = 'proxy' | 'direct';

/**
 * Configured upload mode at each level. The most specific wins:
 * per-call → per-disk → global → `auto`.
 */
export interface UploadModeLevels {
  global?: UploadMode;
  perDisk?: UploadMode;
  perCall?: UploadMode;
}

/**
 * Decide whether an upload goes through the backend (`proxy`, resumable tus) or
 * straight to the disk (`direct`, presigned/native-multipart).
 *
 * - `proxy`: always allowed (every driver can accept bytes through `put`).
 * - `direct`: requires the driver to support presign or native multipart; otherwise throws.
 * - `auto`: `direct` when the driver is presign/multipart-capable, else `proxy`.
 */
export function resolveUploadMode(
  levels: UploadModeLevels,
  capabilities: DriverCapabilities,
  driverName = 'driver',
): ResolvedUploadMode {
  const mode: UploadMode = levels.perCall ?? levels.perDisk ?? levels.global ?? 'auto';
  const directCapable = capabilities.presign || capabilities.multipart;

  if (mode === 'proxy') return 'proxy';
  if (mode === 'direct') {
    if (!directCapable) throw new UnsupportedOperationError(driverName, 'direct upload');
    return 'direct';
  }
  return directCapable ? 'direct' : 'proxy';
}
