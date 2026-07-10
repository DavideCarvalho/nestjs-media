---
'@dudousxd/nestjs-media-dashboard': patch
---

Disk browser: fix a frozen page when a bucket has a stray leading-slash key

A key with a leading slash makes S3 emit an empty-named `/` "folder" (CommonPrefix). Because the driver normalizes an all-slash prefix back to the root, listing *into* that folder returned the root again — the phantom included — a self-reference that infinite-looped the folder tree and froze the page.

- The listing now drops folders whose name is empty (all-slash CommonPrefixes). Those leading-slash keys are unreachable from the console anyway (the driver strips the leading slash).
- The folder tree gained a cycle guard: a child that repeats an ancestor node is skipped, so no self-referential listing can recurse forever.
