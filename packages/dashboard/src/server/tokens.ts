// Cross-package by-value tokens. These MUST use the exact same `Symbol.for` keys as
// `@dudousxd/nestjs-media`'s `tokens.ts`. The global symbol registry guarantees identity across
// packages, so the console resolves the host-provided values without importing the (heavier,
// controller-carrying) nestjs package — this package depends only on `-core`. Do not change these
// keys without changing them there too. Mirrors `@dudousxd/nestjs-media-telescope`'s media-tokens.

/** The configured `MediaStore` (or `null`), provided by `MediaModule`. */
export const MEDIA_STORE: symbol = Symbol.for('nestjs-media:store');
/** The configured `UploadSessionStore` (or `null`), provided by `MediaModule`. */
export const MEDIA_UPLOAD_SESSIONS: symbol = Symbol.for('nestjs-media:upload-sessions');
/** The `StorageManager` (alias of `MediaModule`'s internal `MEDIA_STORAGE` token). */
export const MEDIA_STORAGE_SHARED: symbol = Symbol.for('nestjs-media:storage');

/** Carries the resolved UI mount base (e.g. `/media`) to the UI controller. */
export const MEDIA_DASHBOARD_BASE_PATH: symbol = Symbol('MEDIA_DASHBOARD_BASE_PATH');
/** Carries the resolved JSON API base (e.g. `/api/media/console`) the SPA fetches from. */
export const MEDIA_DASHBOARD_API_PATH: symbol = Symbol('MEDIA_DASHBOARD_API_PATH');
/** Carries whether destructive action routes were enabled (`options.actions`). */
export const MEDIA_DASHBOARD_ACTIONS: symbol = Symbol('MEDIA_DASHBOARD_ACTIONS');

/** Carries the resolved console-auth config (`ResolvedConsoleAuth | null`) to the guard/controller. */
export const MEDIA_CONSOLE_AUTH: symbol = Symbol('MEDIA_CONSOLE_AUTH');
/** Carries the cookie `Path` (the JSON API base) so the session cookie rides every API request. */
export const MEDIA_CONSOLE_COOKIE_PATH: symbol = Symbol('MEDIA_CONSOLE_COOKIE_PATH');
