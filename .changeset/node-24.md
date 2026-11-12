---
"@dudousxd/nestjs-media": minor
"@dudousxd/nestjs-media-client": minor
"@dudousxd/nestjs-media-codegen": minor
"@dudousxd/nestjs-media-core": minor
"@dudousxd/nestjs-media-dashboard": minor
"@dudousxd/nestjs-media-database-drizzle": minor
"@dudousxd/nestjs-media-database-mikro-orm": minor
"@dudousxd/nestjs-media-database-prisma": minor
"@dudousxd/nestjs-media-database-typeorm": minor
"@dudousxd/nestjs-media-disk-s3": minor
"@dudousxd/nestjs-media-image-sharp": minor
"@dudousxd/nestjs-media-react": minor
"@dudousxd/nestjs-media-telescope": minor
"@dudousxd/nestjs-media-testing": minor
"@dudousxd/nestjs-media-upload-redis": minor
---

Require Node.js 24 or newer: `engines.node` is now `>=24` (was `>=20`, or unset). CI tests on Node 24 and 26. Upgrade Node, then the packages.

**Breaking (`@dudousxd/nestjs-media-core`):** the `MediaDiagnosticEnvelope` type, kept only for code written against the old media-specific envelope, is removed. Type a message from an `aviary:media:<event>` channel as `DiagnosticEvent` from `@dudousxd/nestjs-diagnostics` (same shape). See the docs' Upgrading page.
