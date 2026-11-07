import { UnsupportedOperationError } from './errors';
import type { MediaDiskCapabilities } from './types';

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
 * - `proxy`: always allowed (every disk accepts bytes through `put`).
 * - `direct`: requires presign or a multipart side-car; otherwise throws.
 * - `auto`: `direct` when the disk can presign or has a multipart side-car, else `proxy`.
 */
export function resolveUploadMode(
  levels: UploadModeLevels,
  capabilities: Pick<MediaDiskCapabilities, 'presign' | 'multipart'>,
  diskName = 'disk',
): ResolvedUploadMode {
  const mode: UploadMode = levels.perCall ?? levels.perDisk ?? levels.global ?? 'auto';
  const directCapable = capabilities.presign || capabilities.multipart;

  if (mode === 'proxy') return 'proxy';
  if (mode === 'direct') {
    if (!directCapable) throw new UnsupportedOperationError(diskName, 'direct upload');
    return 'direct';
  }
  return directCapable ? 'direct' : 'proxy';
}
