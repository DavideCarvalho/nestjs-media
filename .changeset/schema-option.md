---
'@dudousxd/nestjs-media-database-drizzle': minor
'@dudousxd/nestjs-media-database-mikro-orm': minor
'@dudousxd/nestjs-media-database-typeorm': minor
'@dudousxd/nestjs-media-database-prisma': minor
---

A `schema` option keeps the media tables in a database schema of their own (on MySQL, a database), and every statement names it: `search_path` is never used. Drizzle Postgres: `new DrizzlePgMediaStore(db, { schema })`, the same on `DrizzlePgUploadSessionStore` and the `/nest` factories, `mediaPgTables(schema)` for drizzle-kit, and `createMediaPgTables(db, { schema })` / `mediaPgDdl(schema)` (they create the schema). TypeORM and MikroORM: register `mediaEntity({ schema })` and pass `{ schema }` to the store (and to `ensureMediaSchema`, which creates the schema or MySQL database and heals only the media table). A role that may not create the schema gets the grant it needs; SQLite with `schema` throws. Prisma: documented `@@schema` setup (the store issues no SQL of its own). On MySQL, TypeORM's `ensureMediaSchema` (and MikroORM's with `schema`) now creates `idx_media_tenant` with 191-character prefixes, so it fits InnoDB's key limit. Without `schema`, nothing changes.
