---
"@dudousxd/nestjs-media-core": minor
"@dudousxd/nestjs-media-testing": minor
"@dudousxd/nestjs-media-database-drizzle": minor
"@dudousxd/nestjs-media-database-mikro-orm": minor
"@dudousxd/nestjs-media-database-prisma": minor
"@dudousxd/nestjs-media-database-typeorm": minor
---

`MediaStore` gains an optional `isListCursor(cursor)`: whether a cursor is one `list()` could have returned. `list()` itself still reads a cursor it cannot decode as "no cursor" and starts from the first page; a caller that must tell a forged cursor apart asks first. Every bundled store (in-memory, Drizzle SQLite/Postgres, MikroORM, Prisma, TypeORM) implements it, and the store conformance suite checks it when a store has it. Optional and additive: a third-party store without it keeps working as before.
