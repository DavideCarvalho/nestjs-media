---
"@dudousxd/nestjs-media": minor
"@dudousxd/nestjs-media-dashboard": minor
---

Mount the routes yourself. `MediaModule.forRoot`/`forRootAsync` take `routes: false` to mount no upload controller (the per-surface `mount: { tus?, multipart?, direct? }`, formerly `forRootAsync`-only, now works on `forRoot` too), and `MediaDashboardModule.forRoot`/`forRootAsync` take `routes: false` to mount no console controller. Every provider keeps working, so you serve the same routes from controllers of your own, protected with ordinary Nest decorators, by extending the exported controller classes (`@Can(MediaPolicy, 'upload') @Controller('api/uploads') class UploadsController extends MediaUploadController {}`). The dashboard now exports `MediaDashboardUiController`, `MediaConsoleReadController` and `MediaConsoleActionsController`, and its modules export the providers those controllers inject. The docs gain one "Protecting the routes" section: mount them yourself, or `decorators`, and the production rule that requires one of the two.
