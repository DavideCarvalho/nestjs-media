---
"@dudousxd/nestjs-media-core": minor
"@dudousxd/nestjs-media-disk-s3": minor
"@dudousxd/nestjs-media": minor
"@dudousxd/nestjs-media-upload-redis": minor
"@dudousxd/nestjs-media-testing": minor
"@dudousxd/nestjs-media-disk-local": minor
"@dudousxd/nestjs-media-database-mikro-orm": minor
"@dudousxd/nestjs-media-telescope": minor
---

Add presigned S3 multipart direct uploads (DirectUploadManager + MultipartUploadDriver surface + MediaDirectUploadController + MediaModule.direct option) and a Redis UploadSessionStore adapter (@dudousxd/nestjs-media-upload-redis) for multi-replica resumable proxy uploads. Both modes selectable via uploadMode.
