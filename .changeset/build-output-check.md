---
"@dudousxd/nestjs-media-client": patch
"@dudousxd/nestjs-media-codegen": patch
"@dudousxd/nestjs-media-core": patch
"@dudousxd/nestjs-media-dashboard": patch
"@dudousxd/nestjs-media-database-drizzle": patch
"@dudousxd/nestjs-media-database-mikro-orm": patch
"@dudousxd/nestjs-media-database-prisma": patch
"@dudousxd/nestjs-media-database-typeorm": patch
"@dudousxd/nestjs-media-disk-s3": patch
"@dudousxd/nestjs-media-image-sharp": patch
"@dudousxd/nestjs-media": patch
"@dudousxd/nestjs-media-react": patch
"@dudousxd/nestjs-media-telescope": patch
"@dudousxd/nestjs-media-testing": patch
"@dudousxd/nestjs-media-upload-redis": patch
---

Fix packages that could be published without files their `exports` point to. The two tsup passes (ESM, CJS) no longer each clean `dist/` while running at the same time; `dist/` is cleaned once before the build. A new `check:exports` step (also `prepack`) fails the release if any `exports`/`main`/`types` path is missing.
