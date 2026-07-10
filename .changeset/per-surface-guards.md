---
"@dudousxd/nestjs-media": minor
---

`guards` now also accepts a per-surface object — `guards: { tus: [AdminGuard], multipart: [AuthenticatedGuard] }`
— gating each upload controller with its own list, since upload surfaces often carry different
sensitivity (session creation admin-only, part PUTs any authenticated user). The plain-array form
keeps gating all three uniformly. An omitted key leaves that surface unguarded.
