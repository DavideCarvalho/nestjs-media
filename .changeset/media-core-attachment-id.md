---
"@dudousxd/nestjs-media-core": patch
---

Add optional `id` to `AttachmentManager.createFromFile` options: a caller-supplied id segment replaces the generated UUID in the key, enabling deterministic, idempotent-overwrite paths (e.g. durable steps that re-render the same file).
