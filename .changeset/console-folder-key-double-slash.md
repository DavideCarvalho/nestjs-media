---
'@dudousxd/nestjs-media-dashboard': patch
---

Fix folder uploads and recursive folder delete.

- **Upload/create inside a folder no longer double-slashes the key.** The browsed prefix arrives from S3 folder navigation with a trailing slash (CommonPrefixes end in the delimiter), so joining it to a filename produced `folder//file`, which surfaced as a phantom nested folder. The key builder now strips the trailing slash before joining.
- **Folder delete is now genuinely recursive.** The sweep listed with the driver's default `/` delimiter, which groups nested keys into CommonPrefixes — so only direct children were deleted and anything nested survived. It now lists flat (empty delimiter) and deletes the zero-byte marker explicitly (its key equals the sweep prefix, which listing filters out).
