---
"@dudousxd/nestjs-media-core": minor
"@dudousxd/nestjs-media": minor
"@dudousxd/nestjs-media-dashboard": minor
"@dudousxd/nestjs-media-database-drizzle": minor
"@dudousxd/nestjs-media-database-mikro-orm": minor
"@dudousxd/nestjs-media-database-prisma": minor
"@dudousxd/nestjs-media-database-typeorm": minor
"@dudousxd/nestjs-media-testing": minor
"@dudousxd/nestjs-media-upload-redis": minor
---

Media follows the request's tenant from `@dudousxd/nestjs-context` (opt-in, off by default).

- `MediaModule.forRoot({ tenancy })`: `'inherit'` (default, follows `ContextModule`'s `tenancy.enabled`), `false`, or `{ enabled, kinds, nullRows }`.
- With tenancy on, `attach` and resumable uploads stamp the tenant (an explicit `tenantId` wins); `library.get/list/locate/url`, conversions, `MediaService.serve/url/delete`, upload sessions and the dashboard's library and uploads views apply the matching rule on top of `authorize`. A record or session of another tenant is not found (404), never 403.
- Every store gains a nullable `tenant_id` (TypeORM, MikroORM, Drizzle sqlite/pg incl. upload sessions, the Prisma model docs) with an index, and `enableTenancy()`. With tenancy on and the column missing, the boot fails with `MediaTenancyUnavailableError` and the fix. With tenancy off, the column is never read or written.
- Hidden or missing behaves the same: `library.delete()`, `MediaService.delete()` and upload `abort()` are a silent no-op. With tenancy on, the dashboard's delete record and cancel upload are a 404, whether the id belongs to another tenant or doesn't exist.
- A store's `save` (and the Drizzle pg session store's `create`/`update`) returns the `tenantId` it persisted: none while tenancy is off. TypeORM writes the row and its tenant in one transaction.
- New `library.get(id)`. Docs: the Tenancy page, with backfill SQL.
