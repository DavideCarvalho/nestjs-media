---
"@dudousxd/nestjs-media-dashboard": minor
---

Add a `decorators?: ClassDecorator[]` option to `MediaDashboardModule.forRoot`/`forRootAsync` (static on the async variant), applied to every console controller (page, read, actions and auth), e.g. `[UseGuards(AuthenticationGuard), Can(MediaPolicy, 'console')]`. Each registration decorates fresh controller subclasses, so decorators never leak between registrations. The console controllers are now marked `@Can.Anyone()`-open (`'authorization:can-anyone'`), so `@nestjs/authorization`'s deny-by-default global guard no longer refuses them; a `Can(...)` passed through `decorators` is still enforced, and `auth`/`guards` keep working unchanged.
