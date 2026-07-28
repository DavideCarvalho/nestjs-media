// Standalone runnable demo: boots a REAL Nest app (listening on a real socket) backed
// by a real S3 (MinIO), logs every HTTP request as it arrives, then drives it with the
// client's uploadMediaParallel so you can watch the concurrent part PUTs hit the server.
//   node packages/nestjs/demo/parallel-upload-demo.mjs
import 'reflect-metadata';
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MediaModule } from '@dudousxd/nestjs-media';
import { uploadMediaParallel } from '@dudousxd/nestjs-media-client';
import { S3Driver } from '@dudousxd/nestjs-media-disk-s3';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { GenericContainer } from 'testcontainers';

// Minimal in-memory UploadSessionStore (the -testing package's index pulls in vitest,
// which can't be imported outside a test run) — same contract: create/get/update/delete
// plus the atomic addPart/listParts that the parallel path needs.
class MemStore {
  #sessions = new Map();
  #parts = new Map();
  async create(session) {
    this.#sessions.set(session.id, { ...session });
    return { ...session };
  }
  async get(id) {
    const v = this.#sessions.get(id);
    return v ? { ...v } : null;
  }
  async update(session) {
    this.#sessions.set(session.id, { ...session });
    return { ...session };
  }
  async delete(id) {
    this.#sessions.delete(id);
    this.#parts.delete(id);
  }
  async addPart(id, part) {
    const m = this.#parts.get(id) ?? new Map();
    m.set(part.partNumber, part.etag);
    this.#parts.set(id, m);
  }
  async listParts(id) {
    const m = this.#parts.get(id) ?? new Map();
    return [...m.entries()].map(([partNumber, etag]) => ({ partNumber: Number(partNumber), etag }));
  }
}

const BUCKET = 'demo-media';
const KEY = 'k/demo-parallel.bin';
const MIB = 1024 * 1024;
const t0 = Date.now();
const ms = () => String(Date.now() - t0).padStart(5, ' ');

console.log(`[${ms()}ms] starting MinIO (testcontainers)...`);
const container = await new GenericContainer('minio/minio:latest')
  .withExposedPorts(9000)
  .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
  .withCommand(['server', '/data'])
  .start();

const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
const s3 = new S3Client({
  region: 'us-east-1',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
});
await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
console.log(`[${ms()}ms] MinIO up at ${endpoint}, bucket "${BUCKET}" created`);

const app = await NestFactory.create(
  MediaModule.forRoot({
    default: BUCKET,
    disks: { [BUCKET]: new S3Driver({ client: s3, bucket: BUCKET }) },
    uploadSessions: new MemStore(),
    tus: { disk: BUCKET, basePath: '/media/uploads', keyFor: () => KEY },
  }),
  { bodyParser: false, logger: false },
);
// Log every request as the server receives it, so concurrent PUTs are visible.
app.use((req, res, next) => {
  const started = ms();
  console.log(`[${started}ms] --> ${req.method} ${req.url}`);
  res.on('finish', () => console.log(`[${ms()}ms] <-- ${req.method} ${req.url} ${res.statusCode}`));
  next();
});
app.use(express.raw({ type: 'application/offset+octet-stream', limit: '32mb' }));
await app.listen(3999);
console.log(`[${ms()}ms] APP LISTENING on http://127.0.0.1:3999  (real Nest server)`);

// 14 MiB payload -> with a 5 MiB chunk the client makes 3 parts (5 + 5 + 4).
const payload = Buffer.concat([
  Buffer.alloc(5 * MIB, 0xa),
  Buffer.alloc(5 * MIB, 0xb),
  Buffer.alloc(4 * MIB, 0xc),
]);
const blob = new Blob([payload]);

let inFlight = 0;
let maxInFlight = 0;
const fetchImpl = async (input, init) => {
  const url = new URL(String(input), 'http://127.0.0.1:3999');
  const isPart = init?.method === 'PUT' && url.pathname.includes('/parts/');
  if (isPart) {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    console.log(`[${ms()}ms]     client: PUT ${url.pathname} (in-flight now: ${inFlight})`);
  }
  try {
    return await fetch(url, init);
  } finally {
    if (isPart) inFlight -= 1;
  }
};

console.log(`[${ms()}ms] client: uploadMediaParallel  (14 MiB, chunk 5 MiB, concurrency 3)`);
const result = await uploadMediaParallel(blob, {
  filename: 'demo-parallel.bin',
  basePath: '/media/uploads',
  chunkSize: 5 * MIB,
  concurrency: 3,
  fetchImpl,
});
console.log(`[${ms()}ms] client: done, location = ${result.location}`);
console.log(`[${ms()}ms] MAX CONCURRENT PART PUTS = ${maxInFlight}`);

const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
const bytes = Buffer.from(await got.Body.transformToByteArray());
const ok = bytes.length === payload.length && bytes.equals(payload);
console.log(`[${ms()}ms] verify object in S3: ${bytes.length} bytes, byte-identical = ${ok}`);

await app.close();
await container.stop();
console.log(`[${ms()}ms] torn down. RESULT: ${ok && maxInFlight >= 2 ? 'PASS' : 'FAIL'}`);
process.exit(ok && maxInFlight >= 2 ? 0 : 1);
