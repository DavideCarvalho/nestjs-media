---
"@dudousxd/nestjs-media": minor
---

**Breaking:** the upload routes are now protected only with NestJS's first-party tools (`@nestjs/authentication`, `@nestjs/authorization`), and unprotected upload routes refuse to boot in production.

- New `decorators?: ClassDecorator[]` on `MediaModule.forRoot`/`forRootAsync` (static on the async variant), applied to every upload controller the module mounts, e.g. `[UseGuards(AuthenticationGuard), Can(MediaPolicy, 'upload')]`. Each registration decorates fresh controller subclasses, so decorators never leak between registrations.
- The upload controllers are marked `@Can.Anyone()`-open (`'authorization:can-anyone'`), so `@nestjs/authorization`'s deny-by-default global guard doesn't refuse them; a `Can(...)` passed through `decorators` is still enforced.
- Removed the `guards` option (both the array and the per-surface `{ tus, multipart, direct }` form) and the `MediaUploadGuards` type.
- When `NODE_ENV === 'production'`, `forRoot`/`forRootAsync` throw if they mount any upload controller with no `decorators` (an empty array counts as none); the error names both ways to protect them. A registration that mounts nothing boots as usual, and outside production undecorated routes mount open, as before.

Migration: `guards: [AuthGuard]` → `decorators: [UseGuards(AuthGuard)]`; per-surface guards → `routes: false` (or `mount`) plus your own subclasses of `MediaUploadController` / `MediaMultipartUploadController` / `MediaDirectUploadController`, each decorated as you need.
