// The React tier of `@dudousxd/nestjs-media-dashboard`, published at the `./react` subpath so a
// host that only mounts the NestJS module never pulls React in. Three levels, pick one:
//
//   openMediaConsole(...)        — no React at all (`./client`), you own everything
//   useOpenMediaConsole(...)     — state for a launcher UI, you own the markup
//   <OpenMediaConsoleButton />   — drop-in, unstyled, forwards every button prop
//
// `openMediaConsoleMutationOptions` wires the same call into TanStack Query without this package
// depending on TanStack.
export * from './use-open-console.js';
export * from './open-console-button.js';
// Re-exported so a React consumer needs one import path, not two. Only the console-launcher
// primitives: `./client` also exports the console's own data client, which a launcher never needs.
export * from '../client/console-session.js';
