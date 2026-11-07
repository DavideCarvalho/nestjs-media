import { Readable } from 'node:stream';
import { type MultipartUploadDriver, foldListing } from '@dudousxd/nestjs-media-core';
import { type StorageDisk, StorageFileNotFoundError } from '@nestjs/storage';
import { describe, expect, it } from 'vitest';

export interface MediaDiskConformanceExtensions {
  /**
   * The disk's multipart side-car, to check it against the disk (same keys, assembled bytes). A
   * function is called in each test, for a side-car built in `beforeAll` (a container's port).
   */
  multipart?: MultipartUploadDriver | (() => MultipartUploadDriver);
  /** A unique key prefix per run, for disks shared between test runs (a bucket). Default: random. */
  prefix?: string;
}

/**
 * What nestjs-media relies on from a `StorageDisk`, checked against a real disk: `LocalDisk`,
 * `InMemoryDisk`, `S3Disk` on MinIO, or your own subclass. `@nestjs/storage` tests its disks
 * itself; this suite covers the media layer's use of them — streamed writes of unknown length
 * (resumable assembly), sizes from `put()`, ranged reads (the dashboard's previews), flat listing
 * folded into folders, batch delete, streamed cross-disk copies — plus, with `ext.multipart`, the
 * multipart side-car addressing the same objects as the disk.
 *
 * Call it inside a spec file. `makeDisk` may return the same disk every time; every test writes
 * under its own prefix.
 */
export function describeMediaDiskConformance(
  name: string,
  makeDisk: () => StorageDisk | Promise<StorageDisk>,
  ext: MediaDiskConformanceExtensions = {},
): void {
  const run = ext.prefix ?? `conformance-${Math.random().toString(36).slice(2, 10)}`;
  let counter = 0;
  const scope = () => `${run}/${++counter}`;
  const read = async (stream: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString();
  };

  describe(`media disk conformance: ${name}`, () => {
    it('put() reports the size of a stream of unknown length, and get() streams it back', async () => {
      const disk = await makeDisk();
      const key = `${scope()}/streamed.bin`;
      const parts = ['hello ', 'streamed ', 'world'];
      const written = await disk.put(key, Readable.from(parts.map((p) => Buffer.from(p))), {
        contentType: 'application/octet-stream',
      });
      expect(written.size).toBe(20);
      expect(await read((await disk.get(key)).body)).toBe(parts.join(''));
    });

    it('keeps the content type it was given', async () => {
      const disk = await makeDisk();
      const key = `${scope()}/a.bin`;
      await disk.put(key, Buffer.from('x'), { contentType: 'image/webp' });
      expect((await disk.stat(key)).contentType).toBe('image/webp');
    });

    it('a contentLength that does not match fails the write and writes nothing', async () => {
      const disk = await makeDisk();
      const key = `${scope()}/short.bin`;
      await expect(
        disk.put(key, Readable.from([Buffer.from('abc')]), { contentLength: 5 }),
      ).rejects.toThrow();
      expect(await disk.exists(key)).toBe(false);
    });

    it('reads byte ranges with an inclusive end, clamped at EOF, and suffixes', async () => {
      const disk = await makeDisk();
      const key = `${scope()}/alphabet.txt`;
      await disk.put(key, 'abcdefghijklmnopqrstuvwxyz');
      const slice = await disk.get(key, { range: { start: 3, end: 7 } });
      expect(await read(slice.body)).toBe('defgh');
      expect(slice.range).toEqual({ start: 3, end: 7 });
      expect(slice.size).toBe(26);
      expect(await read((await disk.get(key, { range: { start: 20, end: 9999 } })).body)).toBe(
        'uvwxyz',
      );
      expect(await read((await disk.get(key, { range: { suffix: 3 } })).body)).toBe('xyz');
    });

    it('a missing file is StorageFileNotFoundError on get() and stat()', async () => {
      const disk = await makeDisk();
      const key = `${scope()}/missing`;
      await expect(disk.get(key)).rejects.toBeInstanceOf(StorageFileNotFoundError);
      await expect(disk.stat(key)).rejects.toBeInstanceOf(StorageFileNotFoundError);
    });

    it('delete([...]) removes several keys and ignores missing ones', async () => {
      const disk = await makeDisk();
      const base = scope();
      await disk.put(`${base}/a`, 'a');
      await disk.put(`${base}/b`, 'b');
      await disk.delete([`${base}/a`, `${base}/b`, `${base}/never`]);
      expect(await disk.exists(`${base}/a`)).toBe(false);
      expect(await disk.exists(`${base}/b`)).toBe(false);
      await expect(disk.delete([])).resolves.toBeUndefined();
    });

    it('lists flat, in key order, and the flat listing folds into one folder level', async () => {
      const disk = await makeDisk();
      const base = scope();
      for (const key of [
        'docs/a.txt',
        'docs/b.txt',
        'docs/sub/c.txt',
        'docs/sub/deep/d.txt',
        'top.txt',
      ]) {
        await disk.put(`${base}/${key}`, key);
      }
      const flat: string[] = [];
      for await (const entry of disk.listAll({ prefix: `${base}/docs/` })) flat.push(entry.key);
      expect(flat).toEqual([
        `${base}/docs/a.txt`,
        `${base}/docs/b.txt`,
        `${base}/docs/sub/c.txt`,
        `${base}/docs/sub/deep/d.txt`,
      ]);

      const level = await foldListing(disk, `${base}/docs/`, { limit: 50 });
      expect(level.folders).toEqual([`${base}/docs/sub/`]);
      expect(level.files.map((f) => f.key)).toEqual([`${base}/docs/a.txt`, `${base}/docs/b.txt`]);
      expect(level.cursor).toBeUndefined();
    });

    it('folding pages without repeating a folder across a page boundary', async () => {
      const disk = await makeDisk();
      const base = scope();
      for (const key of ['a/1', 'a/2', 'a/3', 'b.txt', 'c/1', 'd.txt'])
        await disk.put(`${base}/${key}`, 'x');
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await foldListing(disk, `${base}/`, {
          limit: 1,
          ...(cursor ? { cursor } : {}),
          pageSize: 2,
        });
        seen.push(...page.folders, ...page.files.map((f) => f.key));
        cursor = page.cursor;
      } while (cursor);
      expect(seen).toEqual([`${base}/a/`, `${base}/b.txt`, `${base}/c/`, `${base}/d.txt`]);
    });

    it('streams a copy from one disk to another without buffering it', async () => {
      const disk = await makeDisk();
      const base = scope();
      await disk.put(`${base}/src.txt`, 'copied bytes', { contentType: 'text/plain' });
      const source = await disk.get(`${base}/src.txt`);
      await disk.put(`${base}/dst.txt`, source.body, {
        contentType: source.contentType,
        contentLength: source.size,
      });
      expect(await disk.getText(`${base}/dst.txt`)).toBe('copied bytes');
      expect((await disk.stat(`${base}/dst.txt`)).contentType).toMatch(/^text\/plain/);
    });

    if (ext.multipart) {
      const source = ext.multipart;
      const sidecar = () => (typeof source === 'function' ? source() : source);
      it('the multipart side-car assembles parts at a key the disk reads back', async () => {
        const disk = await makeDisk();
        const multipart = sidecar();
        const key = `${scope()}/multipart.bin`;
        const MIB = 1024 * 1024;
        const part1 = Buffer.alloc(5 * MIB, 1);
        const part2 = Buffer.from('tail');
        const { uploadId } = await multipart.createMultipartUpload(key, {
          contentType: 'application/x-test',
        });
        const parts = await Promise.all([
          multipart.uploadPart(key, uploadId, 2, part2),
          multipart.uploadPart(key, uploadId, 1, part1),
        ]);
        await multipart.completeMultipartUpload(
          key,
          uploadId,
          parts.sort((a, b) => a.partNumber - b.partNumber),
        );
        const stat = await disk.stat(key);
        expect(stat.size).toBe(part1.length + part2.length);
        expect(stat.contentType).toBe('application/x-test');
        const tail = await disk.get(key, { range: { suffix: 4 } });
        expect(await read(tail.body)).toBe('tail');
      });

      it('abort leaves nothing behind', async () => {
        const disk = await makeDisk();
        const multipart = sidecar();
        const key = `${scope()}/aborted.bin`;
        const { uploadId } = await multipart.createMultipartUpload(key);
        await multipart.uploadPart(key, uploadId, 1, Buffer.from('x'));
        await multipart.abortMultipartUpload(key, uploadId);
        expect(await disk.exists(key)).toBe(false);
      });

      it('presigns a part URL', async () => {
        const multipart = sidecar();
        const key = `${scope()}/presigned.bin`;
        const { uploadId } = await multipart.createMultipartUpload(key);
        const url = await multipart.presignUploadPart(key, uploadId, 1, 60);
        expect(url).toMatch(/partNumber=1/);
        expect(url).toMatch(/uploadId=/);
        await multipart.abortMultipartUpload(key, uploadId);
      });

      it('listFolders (when the side-car has it) agrees with the folded flat listing', async () => {
        const multipart = sidecar();
        if (!multipart.listFolders) return;
        const listFolders = multipart.listFolders.bind(multipart);
        const disk = await makeDisk();
        const base = scope();
        for (const key of ['docs/a.txt', 'docs/sub/c.txt', 'docs/sub/deep/d.txt', 'docs/z/1']) {
          await disk.put(`${base}/${key}`, 'x');
        }
        const native = await listFolders(`${base}/docs/`);
        const folded = await foldListing(disk, `${base}/docs/`, { limit: 50 });
        expect(native.folders).toEqual(folded.folders);
        expect(native.files.map((f) => f.key)).toEqual(folded.files.map((f) => f.key));
      });
    }
  });
}
