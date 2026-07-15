---
'@dudousxd/nestjs-media-disk-s3': minor
---

`stream()` now returns a hardened Body: connection death surfaces as a stream error instead of a silent permanent hang.

Since response-checksum validation became the AWS SDK default, GetObject bodies are smithy `ChecksumStream`s wired to the socket with a bare legacy `pipe()`, which drops source errors. If S3/MinIO kills the connection mid-stream (e.g. idle timeout while the consumer applies backpressure), the Body never emits anything — pending reads hang forever and GC can collect the consumer's suspended await chain. `hardenBodyStream` (also exported) walks the `.source` wrapper chain and bridges error/premature-close from every layer into the Body, and tears the chain down (releasing the socket) when the Body is destroyed early.
