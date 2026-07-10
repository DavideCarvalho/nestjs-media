---
"@dudousxd/nestjs-media-dashboard": patch
---

Call `driver.stat()` directly in the console service now that `StorageDriver.stat` is required — the
`driver.size()` fallback ternaries were dead code.
