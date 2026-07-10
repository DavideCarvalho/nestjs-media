---
"@dudousxd/nestjs-media-client": minor
---

Add an optional `getHeaders?: () => HeadersInit | Promise<HeadersInit>` option to
`streamChunks`, `streamChunksParallel`, and the `uploadMedia`/`uploadMediaParallel` wrappers.
It's resolved fresh before every request (each part PUT/PATCH, the complete POST, and the
session-initiate call) and merged over the static `headers` option, with `getHeaders` values
winning on key conflict. Use it to refresh short-lived bearer tokens that might expire during a
long-running upload.
