---
"@dudousxd/nestjs-media-core": patch
---

Add `ResumableUploadManager.writePart(id, partNumber, chunk)` and `listParts(id)` for a
proxy-parallel multipart upload path, plus optional `addPart`/`listParts` on
`UploadSessionStore`. `complete()` now orders parts ascending by `partNumber`. The
sequential tus path is unchanged.
