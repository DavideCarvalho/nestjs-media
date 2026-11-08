---
"@dudousxd/nestjs-media-database-typeorm": minor
"@dudousxd/nestjs-media-database-drizzle": minor
---

New `/nest` entries with store factories on a named connection, for `MediaModule.forRoot({ store, uploadSessions })`: `typeOrmMediaStore({ connectionName, autoCreateSchema })` (on `getDataSourceToken()` from `@nestjs/typeorm`), and `drizzleMediaStore`, `drizzlePgMediaStore`, `drizzlePgUploadSessions` (on `getDrizzleToken()` from `@nestjs/drizzle`). `@nestjs/typeorm` and `@nestjs/drizzle` are optional peers, loaded only by `/nest`.
