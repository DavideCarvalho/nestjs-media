---
"@dudousxd/nestjs-media": patch
---

Add `MediaMultipartUploadController` with `PUT /media/uploads/:id/parts/:partNumber` (raw
body → S3 multipart part), `POST /media/uploads/:id/complete`, and `GET /media/uploads/:id/parts`
(for resume). Key/disk are resolved from the session id (server-derived, no client→S3 path).
Mount a raw-body parser with a per-part cap on the parts route.
