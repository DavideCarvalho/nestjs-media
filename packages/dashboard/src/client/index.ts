// Headless console-launcher primitives (path derivation + mint-then-navigate). Re-exported here
// because `./client` resolves to this file — see the package's `exports` map.
export {
  ConsoleSessionError,
  mediaConsoleSessionUrl,
  mediaConsoleUrl,
  mintMediaConsoleSession,
  openMediaConsole,
  type OpenConsoleOptions,
} from './console-session.js';

export * from './types.js';
export { apiBase, mediaConsoleClient, type MediaConsoleClient } from './media-console-client.js';
