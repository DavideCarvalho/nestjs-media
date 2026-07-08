import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileNotFoundError, UnsupportedOperationError } from '@dudousxd/nestjs-media-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDriver } from './local-driver';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'media-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('LocalDriver', () => {
  it('puts and gets a buffer, creating nested dirs', async () => {
    const d = new LocalDriver({ root });
    await d.put('docs/a.txt', Buffer.from('hello'));
    expect((await d.get('docs/a.txt')).toString()).toBe('hello');
    expect(await readFile(join(root, 'docs/a.txt'), 'utf8')).toBe('hello');
  });

  it('reports existence and size', async () => {
    const d = new LocalDriver({ root });
    expect(await d.exists('x.txt')).toBe(false);
    await d.put('x.txt', Buffer.from('1234'));
    expect(await d.exists('x.txt')).toBe(true);
    expect(await d.size('x.txt')).toBe(4);
  });

  it('get() throws FileNotFoundError for a missing file', async () => {
    const d = new LocalDriver({ root });
    await expect(d.get('missing.txt')).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('deletes (idempotent)', async () => {
    const d = new LocalDriver({ root });
    await d.put('y.txt', Buffer.from('z'));
    await d.delete('y.txt');
    expect(await d.exists('y.txt')).toBe(false);
    await expect(d.delete('y.txt')).resolves.toBeUndefined();
  });

  it('copies and moves', async () => {
    const d = new LocalDriver({ root });
    await d.put('src.txt', Buffer.from('data'));
    await d.copy('src.txt', 'copy.txt');
    expect((await d.get('copy.txt')).toString()).toBe('data');
    await d.move('copy.txt', 'moved.txt');
    expect(await d.exists('copy.txt')).toBe(false);
    expect((await d.get('moved.txt')).toString()).toBe('data');
  });

  it('url() needs baseUrl; temporaryUrl() unsupported', async () => {
    expect(new LocalDriver({ root }).capabilities).toEqual({
      presign: false,
      multipart: false,
      publicUrls: false,
      list: true,
    });
    await expect(new LocalDriver({ root }).url('a.txt')).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
    const withUrl = new LocalDriver({ root, baseUrl: 'https://cdn.test/files' });
    expect(withUrl.capabilities.publicUrls).toBe(true);
    expect(await withUrl.url('a/b.txt')).toBe('https://cdn.test/files/a/b.txt');
    await expect(withUrl.temporaryUrl('a.txt', 60)).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
  });

  it('rejects path traversal', async () => {
    const d = new LocalDriver({ root });
    await expect(d.put('../escape.txt', Buffer.from('x'))).rejects.toThrow();
  });

  it('stat returns size, last-modified and extension content-type', async () => {
    const d = new LocalDriver({ root });
    await d.put('report.txt', Buffer.from('hello'));
    const meta = await d.stat('report.txt');
    expect(meta.size).toBe(5);
    expect(meta.contentType).toBe('text/plain');
    expect(meta.lastModified).toBeInstanceOf(Date);
  });

  it('stat throws FileNotFoundError when absent', async () => {
    await expect(new LocalDriver({ root }).stat('nope.txt')).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });

  it('deleteMany removes every key and no-ops on []', async () => {
    const d = new LocalDriver({ root });
    await d.put('a.txt', Buffer.from('1'));
    await d.put('b.txt', Buffer.from('2'));
    await d.deleteMany(['a.txt', 'b.txt']);
    expect(await d.exists('a.txt')).toBe(false);
    expect(await d.exists('b.txt')).toBe(false);
    await expect(d.deleteMany([])).resolves.toBeUndefined();
  });
});
