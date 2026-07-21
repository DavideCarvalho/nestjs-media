---
'@dudousxd/nestjs-media-core': minor
'@dudousxd/nestjs-media-upload-redis': patch
---

Resumable uploads can now carry **opaque application metadata** from `createUpload` through to the
upload diagnostics events. `CreateUploadInput` and `UploadSession` gain an optional
`metadata?: Record<string, unknown>`, and it is echoed on the `upload.start` / `upload.complete`
payloads. The library never reads it.

This closes the gap that forced every host into a client round-trip after the bytes landed. Before,
`upload.complete` told you only *that* an object arrived at `disk`/`key` — not what it was for — so
acting on it (index it, attach it to a record, start a workflow) meant the client had to call a
finalize endpoint afterwards, and an abandoned or crashed client left the object orphaned in storage,
uploaded but never processed. Now the host stamps its own correlation data up front and acts purely
on the server-side event:

```ts
await uploads.createUpload({ disk, key, size, metadata: { collectionId } });

subscribe(channelName('media', 'upload.complete'), (message) => {
  const { key, disk, metadata } = message.payload;
  // metadata.collectionId is right here — no finalize call, no orphans
});
```

Omitting `metadata` changes nothing: the key is absent from the session and from both payloads.

`@dudousxd/nestjs-media-upload-redis` is updated to round-trip the field. Its `create()` already
serialised the whole session, but `deserialize()` rebuilds sessions field by field, so without this
the metadata would have been silently dropped on read and never reached `upload.complete`.
