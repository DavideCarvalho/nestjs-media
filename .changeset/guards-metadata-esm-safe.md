---
"@dudousxd/nestjs-media": patch
---

Inline Nest's `GUARDS_METADATA` key instead of deep-importing `@nestjs/common/constants`.
`@nestjs/common` has no `exports` map and ships CJS, so the deep import was emitted
extensionless in our ESM build and rejected by Node's strict ESM resolver — breaking any
consumer whose toolchain resolves the package as real ESM (e.g. vitest externalizing it).
A test pins the inlined literal to the real upstream constant so drift fails loudly.
