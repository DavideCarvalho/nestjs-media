---
"@dudousxd/nestjs-media-core": patch
"@dudousxd/nestjs-media-telescope": patch
---

Accept the current `@dudousxd/nestjs-diagnostics` and `@dudousxd/nestjs-telescope` releases. `@dudousxd/nestjs-media-core` depends on `@dudousxd/nestjs-diagnostics` `>=0.7.0 <1.0.0` instead of the exact `0.7.2`, so an app on 0.8.0 shares one copy instead of installing a second one. `@dudousxd/nestjs-media-telescope`'s peers are now diagnostics `>=0.7.0 <1.0.0` (was `^0.7.0`) and telescope `^1.0.0 || ^2.0.0` (was `^1.0.0`).
