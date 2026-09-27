---
"@dudousxd/nestjs-media-database-drizzle": minor
---

Add Postgres support on a new `@dudousxd/nestjs-media-database-drizzle/pg` subpath (the package root stays the sqlite/libSQL store, unchanged). It exports `mediaPgTable` + `DrizzlePgMediaStore` (a full `MediaStore`, including count/aggregate/keyset-cursor list), `mediaUploadSessionsPgTable` / `mediaUploadPartsPgTable` + `DrizzlePgUploadSessionStore` (a resumable-upload `UploadSessionStore` with atomic `addPart` upserts, `listParts` and filtered `list`), and `createMediaPgTables(db)` / `MEDIA_PG_DDL` for tests and dev. Stores accept any drizzle Postgres database (`PgDatabase`). The `drizzle-orm` peer range is widened to `>=0.38.0 <1.0.0`, so 0.39–0.45 consumers install cleanly.
