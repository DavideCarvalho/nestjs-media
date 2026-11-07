---
"@dudousxd/nestjs-media": minor
---

Add a `decorators?: ClassDecorator[]` option to `MediaModule.forRoot`/`forRootAsync` (static on the async variant), applied to every upload controller the module mounts, e.g. `[UseGuards(AuthenticationGuard), Can(MediaPolicy, 'upload')]`. Each registration decorates fresh controller subclasses, so decorators never leak between registrations. The upload controllers are now marked `@Can.Anyone()`-open (`'authorization:can-anyone'`), so `@nestjs/authorization`'s deny-by-default global guard no longer refuses them; a `Can(...)` passed through `decorators` is still enforced, and `guards` keeps working unchanged.
