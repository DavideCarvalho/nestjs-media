export {
  MediaDashboardModule,
  type MediaDashboardOptions,
  type MediaDashboardAsyncOptions,
} from './media-dashboard.module.js';
export {
  MediaConsoleApiModule,
  type MediaConsoleApiModuleOptions,
} from './media-console-api.module.js';
// Console access: the `authorize` contract (same names and shapes in every Aviary console).
export {
  type ConsoleAuthorize,
  type ConsoleAuthorizeResult,
  type ConsoleAuthorizer,
  type ConsoleAuthorizerClass,
  type ConsolePolicyCheck,
  type ConsoleDecision,
  type ConsoleAuthorizeCheck,
  authorizeByToken,
  resolveConsoleAuthorize,
  ConsoleAuthorizeGuard,
  ConsoleAuthorizeFilter,
  ConsoleAccessDeniedException,
} from './console-authorize.js';
export type { ObjectUrlConfig, ObjectUrlStrategy } from './object-urls.js';
export { MediaConsoleService } from './media-console.service.js';
// The controllers, for a host that mounts the console itself (`routes: false`) by extending them.
export { MediaDashboardUiController } from './media-dashboard-ui.controller.js';
export { MediaConsoleReadController } from './media-console-read.controller.js';
export { MediaConsoleActionsController } from './media-console-actions.controller.js';
export {
  MEDIA_CONSOLE_AUTHORIZE,
  MEDIA_MULTIPART,
  MEDIA_STORE,
  MEDIA_UPLOAD_SESSIONS,
} from './tokens.js';
// The API response types (also published at the `./client` entry) for host reuse.
export type * from '../client/types.js';
export type {
  ObjectInsight,
  ObjectInsightContext,
  ObjectInsightFact,
  ObjectInsightLink,
  ObjectInsightProvider,
  ObjectInsightsResponse,
} from './object-insights.js';
