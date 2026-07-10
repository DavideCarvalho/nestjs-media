export { MediaDashboardModule, type MediaDashboardOptions } from './media-dashboard.module.js';
export { MediaConsoleApiModule } from './media-console-api.module.js';
export { MediaConsoleService } from './media-console.service.js';
export type {
  ConsoleAuthOptions,
  LoginHook,
  SessionHook,
} from './auth/config.js';
export type { ConsoleSessionUser } from './auth/session-cookie.js';
export {
  MEDIA_STORAGE_SHARED,
  MEDIA_STORE,
  MEDIA_UPLOAD_SESSIONS,
} from './tokens.js';
// The API response types (also published at the `./client` entry) for host reuse.
export type * from '../client/types.js';
