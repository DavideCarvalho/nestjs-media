// These MUST use the exact same `Symbol.for` keys as `@dudousxd/nestjs-media`'s
// `tokens.ts`. The global symbol registry guarantees identity across packages, so the
// telescope providers resolve the host-provided values without importing the (heavier,
// controller-carrying) nestjs package. Do not change these keys without changing them there too.

/** The configured `MediaStore` (or `null`), provided by `MediaModule`. */
export const MEDIA_STORE: symbol = Symbol.for('nestjs-media:store');
/** The configured `UploadSessionStore` (or `null`), provided by `MediaModule`. */
export const MEDIA_UPLOAD_SESSIONS: symbol = Symbol.for('nestjs-media:upload-sessions');
/** The `StorageManager` (alias of `MediaModule`'s internal `MEDIA_STORAGE` token). */
export const MEDIA_STORAGE_SHARED: symbol = Symbol.for('nestjs-media:storage');
