---
'@dudousxd/nestjs-media-dashboard': patch
'@dudousxd/nestjs-media-database-drizzle': patch
'@dudousxd/nestjs-media-database-mikro-orm': patch
'@dudousxd/nestjs-media-database-prisma': patch
'@dudousxd/nestjs-media-database-typeorm': patch
'@dudousxd/nestjs-media-disk-local': patch
'@dudousxd/nestjs-media-disk-s3': patch
'@dudousxd/nestjs-media-image-sharp': patch
'@dudousxd/nestjs-media': patch
'@dudousxd/nestjs-media-telescope': patch
'@dudousxd/nestjs-media-testing': patch
'@dudousxd/nestjs-media-upload-redis': patch
---

Stop the next `core` minor from publishing twelve packages as 1.0.0.

Twelve packages declared their peer dependency on `@dudousxd/nestjs-media-core` as `workspace:*`. Changesets treats a peer bump as breaking for the dependent, and "breaking" on a `0.x` package means `1.0.0` — so the first minor `core` takes would promote the entire repo at once, with no `major` changeset anywhere in sight.

This has not fired yet only because `core` has not taken a minor recently. The identical bug did fire in `nestjs-agent`, where six packages were queued to publish as `1.0.0` off a routine SPI change and were caught in the release PR.

Ranges are now `>=0.8.0 <1.0.0`. `onlyUpdatePeerDependentsWhenOutOfRange` is already set in the changesets config; it just needs a range a `0.9.0` core still satisfies.

Verified by simulation rather than argument: adding a throwaway `core: minor` changeset and running `changeset version` produces twelve `1.0.0` bumps before this change and zero after — `core` goes to `0.9.0` and every dependent stays on a patch.

`workspace:*` in `dependencies` is left alone; it is resolved at publish and causes none of this. Only peers matter.
