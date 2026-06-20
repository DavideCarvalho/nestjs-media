import { FileNotFoundError, type StorageDriver } from '@dudousxd/nestjs-media-core';
import { describe, expect, it } from 'vitest';

/** Shared behavioral contract every StorageDriver must satisfy. Call inside a spec file. */
export function runStorageDriverConformance(
  name: string,
  makeDriver: () => StorageDriver | Promise<StorageDriver>,
): void {
  describe(`StorageDriver conformance: ${name}`, () => {
    it('round-trips a buffer through put/get', async () => {
      const d = await makeDriver();
      await d.put('a/b.txt', Buffer.from('hello'));
      expect((await d.get('a/b.txt')).toString()).toBe('hello');
    });

    it('exists + size reflect writes', async () => {
      const d = await makeDriver();
      expect(await d.exists('x')).toBe(false);
      await d.put('x', Buffer.from('1234'));
      expect(await d.exists('x')).toBe(true);
      expect(await d.size('x')).toBe(4);
    });

    it('get() rejects with FileNotFoundError when absent', async () => {
      const d = await makeDriver();
      await expect(d.get('nope')).rejects.toBeInstanceOf(FileNotFoundError);
    });

    it('delete() removes and is idempotent', async () => {
      const d = await makeDriver();
      await d.put('y', Buffer.from('z'));
      await d.delete('y');
      expect(await d.exists('y')).toBe(false);
      await expect(d.delete('y')).resolves.toBeUndefined();
    });

    it('copy() and move() behave', async () => {
      const d = await makeDriver();
      await d.put('s', Buffer.from('data'));
      await d.copy('s', 'c');
      expect((await d.get('c')).toString()).toBe('data');
      await d.move('c', 'm');
      expect(await d.exists('c')).toBe(false);
      expect((await d.get('m')).toString()).toBe('data');
    });

    it('stream() yields the stored bytes', async () => {
      const d = await makeDriver();
      await d.put('st', Buffer.from('streamed'));
      const chunks: Buffer[] = [];
      for await (const c of await d.stream('st')) chunks.push(Buffer.from(c));
      expect(Buffer.concat(chunks).toString()).toBe('streamed');
    });
  });
}
