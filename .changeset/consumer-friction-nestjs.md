---
"@dudousxd/nestjs-media": minor
---

Three fixes for consumer friction on the upload controllers:

- **`guards` option** on `MediaModule.forRoot`/`forRootAsync` — pass `guards: [YourGuard]` to gate all three upload controllers (tus, multipart, direct) uniformly, instead of reimplementing auth in a `NestMiddleware` because third-party controller classes can't take `@UseGuards`. On `forRootAsync` this is a STATIC field on the config object (not resolved via `useFactory`), since controllers/enhancers are wired at module-build time. **Uploads remain unauthenticated by default when `guards` is omitted — gate this module before exposing it.**
- **`mount` option** on `forRootAsync` (`{ tus?, multipart?, direct? }`, default all `true`) — `forRootAsync` used to always mount all three controllers unconditionally, 501-ing the ones you never configured. Set the ones you don't use to `false` so they 404 instead of existing as dead, always-501 surface.
- **Facade re-exports** — `@dudousxd/nestjs-media`'s `index.ts` now re-exports the error classes (`FileNotFoundError`, etc.), `ResumableUploadManager`, `mediaDiagnosticKey`, `MediaDiagnosticEvent`, `publishMedia`, and the storage-consumer/upload-session types (`StatResult`, `TemporaryUrlOptions`, `ListResult`, `ListEntry`, `ListOptions`, `MultipartPart`, `UploadSession`, `UploadSessionStore`, `UploadSessionListFilter`, `CreateUploadInput`) from `@dudousxd/nestjs-media-core`, so consumers no longer need a direct dependency on `-core` for these.
