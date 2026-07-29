# @dudousxd/nestjs-media-image-sharp

## 0.5.10

### Patch Changes

- 36dd0b0: Stop the next `core` minor from publishing twelve packages as 1.0.0.

  Twelve packages declared their peer dependency on `@dudousxd/nestjs-media-core` as `workspace:*`. Changesets treats a peer bump as breaking for the dependent, and "breaking" on a `0.x` package means `1.0.0` — so the first minor `core` takes would promote the entire repo at once, with no `major` changeset anywhere in sight.

  This has not fired yet only because `core` has not taken a minor recently. The identical bug did fire in `nestjs-agent`, where six packages were queued to publish as `1.0.0` off a routine SPI change and were caught in the release PR.

  Ranges are now `>=0.8.0 <1.0.0`. `onlyUpdatePeerDependentsWhenOutOfRange` is already set in the changesets config; it just needs a range a `0.9.0` core still satisfies.

  Verified by simulation rather than argument: adding a throwaway `core: minor` changeset and running `changeset version` produces twelve `1.0.0` bumps before this change and zero after — `core` goes to `0.9.0` and every dependent stays on a patch.

  `workspace:*` in `dependencies` is left alone; it is resolved at publish and causes none of this. Only peers matter.

## 1.0.0

### Patch Changes

- Updated dependencies [8852c83]
  - @dudousxd/nestjs-media-core@0.8.0

## 0.5.8

### Patch Changes

- Updated dependencies [74e9f4d]
  - @dudousxd/nestjs-media-core@0.7.0

## 0.5.7

### Patch Changes

- Updated dependencies [9901000]
  - @dudousxd/nestjs-media-core@0.6.7

## 0.5.6

### Patch Changes

- Updated dependencies [70cba69]
  - @dudousxd/nestjs-media-core@0.6.6

## 0.5.5

### Patch Changes

- Updated dependencies [1410953]
  - @dudousxd/nestjs-media-core@0.6.5

## 0.5.4

### Patch Changes

- Updated dependencies [7c87433]
  - @dudousxd/nestjs-media-core@0.6.4

## 0.5.3

### Patch Changes

- Updated dependencies [caa8eea]
  - @dudousxd/nestjs-media-core@0.6.3

## 0.5.2

### Patch Changes

- Updated dependencies [03d5b48]
  - @dudousxd/nestjs-media-core@0.6.2

## 0.5.1

### Patch Changes

- Updated dependencies [28734af]
  - @dudousxd/nestjs-media-core@0.6.1

## 0.5.0

### Patch Changes

- Updated dependencies [05af5b4]
  - @dudousxd/nestjs-media-core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [be47230]
  - @dudousxd/nestjs-media-core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [99777bb]
  - @dudousxd/nestjs-media-core@0.3.0
