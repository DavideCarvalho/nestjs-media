---
'@dudousxd/nestjs-media-telescope': patch
---

MediaWatcher claims its recorded diagnostics channels (diagnostics 0.7's claim registry) so the
generic `@dudousxd/nestjs-diagnostics-telescope` bridge auto-skips them — consumers no longer
hand-maintain exclude lists to avoid double-recording. `upload.progress` is deliberately NOT
claimed (this watcher doesn't record it either); muting it on the generic bridge via
`mediaDiagnosticKey('upload.progress')` remains the right call. The claim is released in
`dispose()`.
