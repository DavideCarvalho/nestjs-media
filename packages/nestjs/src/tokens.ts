export const MEDIA_LIBRARY = Symbol('MEDIA_LIBRARY');
export const MEDIA_UPLOADS = Symbol('MEDIA_UPLOADS');
export const MEDIA_TUS = Symbol('MEDIA_TUS');
export const MEDIA_ATTACHMENTS = Symbol('MEDIA_ATTACHMENTS');
export const MEDIA_DIRECT = Symbol('MEDIA_DIRECT');
/** The resolved `MediaModuleOptions` (internal; `forRootAsync`'s factory runs once). */
export const MEDIA_OPTIONS = Symbol('MEDIA_OPTIONS');

// Cross-package tokens: `Symbol.for` (global registry) so the dashboard and telescope packages
// resolve them by value without importing this package (dodges the ESM/CJS dual-copy).
/** The configured `MediaStore` (or `null`). Consumed by the media dashboard and telescope. */
export const MEDIA_STORE = Symbol.for('nestjs-media:store');
/** The configured `UploadSessionStore` (or `null`). Consumed by the media dashboard and telescope. */
export const MEDIA_UPLOAD_SESSIONS = Symbol.for('nestjs-media:upload-sessions');
/**
 * The multipart side-cars by disk name (`MediaModuleOptions.multipart`, `{}` when none).
 * Consumed by the media dashboard (folders, capability badges) and telescope.
 */
export const MEDIA_MULTIPART = Symbol.for('nestjs-media:multipart');
/**
 * The request's tenant scope ({@link MediaTenancyScope}), from `MediaModuleOptions.tenancy`.
 * Consumed by the media dashboard, which reads the stores directly.
 */
export const MEDIA_TENANCY = Symbol.for('nestjs-media:tenancy');
