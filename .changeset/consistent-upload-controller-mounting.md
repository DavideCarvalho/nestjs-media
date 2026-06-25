---
"@dudousxd/nestjs-media": patch
---

Document why `forRootAsync` always mounts both upload controllers and verify the uniform 501 NotImplemented behavior when tus/direct are unconfigured. Unlike `forRoot` (which knows its options at build time and mounts the controllers conditionally), `forRootAsync` resolves options later via `useFactory`, so it cannot mount conditionally; the controllers cleanly respond 501 via their nullable injected manager tokens. No behavior change.
