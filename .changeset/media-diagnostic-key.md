---
"@dudousxd/nestjs-media-core": patch
---

Export `mediaDiagnosticKey(event)` and the `MediaDiagnosticKey` type — the typed `media:<event>` telescope key (the exact key `@dudousxd/nestjs-diagnostics-telescope`'s `exclude` option matches against). The library owns the `media` lib name, so it owns the composed key; callers get a compile error on a misspelled event instead of a silently-non-matching magic string.
