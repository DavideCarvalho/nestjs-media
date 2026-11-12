# @dudousxd/nestjs-media-react

## 0.3.0

### Minor Changes

- [#211](https://github.com/DavideCarvalho/nestjs-media/pull/211) [`8f3315e`](https://github.com/DavideCarvalho/nestjs-media/commit/8f3315e3ba7c4825a51dbf413e1a9615a058312b) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Require Node.js 24 or newer: `engines.node` is now `>=24` (was `>=20`, or unset). CI tests on Node 24 and 26. Upgrade Node, then the packages.

  **Breaking (`@dudousxd/nestjs-media-core`):** the `MediaDiagnosticEnvelope` type, kept only for code written against the old media-specific envelope, is removed. Type a message from an `aviary:media:<event>` channel as `DiagnosticEvent` from `@dudousxd/nestjs-diagnostics` (same shape). See the docs' Upgrading page.

### Patch Changes

- Updated dependencies [[`8f3315e`](https://github.com/DavideCarvalho/nestjs-media/commit/8f3315e3ba7c4825a51dbf413e1a9615a058312b)]:
  - @dudousxd/nestjs-media-client@0.4.0

## 0.2.4

### Patch Changes

- [#199](https://github.com/DavideCarvalho/nestjs-media/pull/199) [`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Fix packages that could be published without files their `exports` point to. The two tsup passes (ESM, CJS) no longer each clean `dist/` while running at the same time; `dist/` is cleaned once before the build. A new `check:exports` step (also `prepack`) fails the release if any `exports`/`main`/`types` path is missing.

- Updated dependencies [[`fa191a3`](https://github.com/DavideCarvalho/nestjs-media/commit/fa191a3e7a982e71e23b8cdd9fd67deec3848437)]:
  - @dudousxd/nestjs-media-client@0.3.1

## 0.2.3

### Patch Changes

- Updated dependencies [74e9f4d]
  - @dudousxd/nestjs-media-client@0.3.0

## 0.2.2

### Patch Changes

- 7553ff1: `useMediaUpload` gains opt-in `parallel` + `concurrency` options that route to
  `uploadMediaParallel`. Default behaviour (sequential) is unchanged.
- Updated dependencies [1951e24]
  - @dudousxd/nestjs-media-client@0.2.1

## 0.2.1

### Patch Changes

- fcddaf0: Ship TanStack Intent agent skills (SKILL.md) inside the package.
