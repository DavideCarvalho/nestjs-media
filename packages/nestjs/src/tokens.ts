export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
export const MEDIA_LIBRARY = Symbol('MEDIA_LIBRARY');
export const MEDIA_UPLOADS = Symbol('MEDIA_UPLOADS');
export const MEDIA_TUS = Symbol('MEDIA_TUS');
export const MEDIA_ATTACHMENTS = Symbol('MEDIA_ATTACHMENTS');
export const MEDIA_DIRECT = Symbol('MEDIA_DIRECT');

// Cross-package tokens: `Symbol.for` (global registry) so the telescope extension can
// resolve them by value without importing this package (dodges the ESM/CJS dual-copy).
/** The configured `MediaStore` (or `null`). Consumed by the media telescope dashboard. */
export const MEDIA_STORE = Symbol.for('nestjs-media:store');
/** The configured `UploadSessionStore` (or `null`). Consumed by the media telescope dashboard. */
export const MEDIA_UPLOAD_SESSIONS = Symbol.for('nestjs-media:upload-sessions');
